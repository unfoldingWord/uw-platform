import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ingestEnvelopeSchema, type IngestEnvelope } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { ingestPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { rewriteItem, seedPerson } from '@uw/db/test-seed';
import { clock } from '../../github/testing/ship-rig.ts';
import { gateWorld, type GateWorld } from '../../testing/gate-world.ts';
import { kernelOn } from '../../testing/kernel.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { notifyConfigOf } from '../config.ts';
import { zulipEnv } from '../testing.ts';
import { zulipIngestHandler } from './inbound.ts';

const channel = '80-89 Technology';
const config = notifyConfigOf(zulipEnv({ '80-89': channel, '20-29': '20-29 Other' })).zulip;
let messages = 500;

type Message = {
  readonly subject: string;
  readonly content?: string;
  readonly sender_email?: string;
  readonly type?: 'stream' | 'private';
  readonly display_recipient?: string;
};

type World = GateWorld & { readonly key: string; readonly topic: string };

function envelopeOf(message: Message): IngestEnvelope {
  messages += 1;
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 1,
    traceId: randomUUID(),
    source: 'zulip',
    deliveryId: `zulip:${messages}`,
    event: 'message',
    receivedAt: '2026-10-02T09:00:00.000Z',
    principal: ingestPrincipal(),
    payload: {
      trigger: 'mention',
      bot_email: 'harness-bot@chat.example.org',
      message: {
        id: messages,
        type: 'stream',
        display_recipient: channel,
        sender_email: 'reader@partner.example',
        content: 'looks good',
        timestamp: 1790000000,
        ...message,
      },
    },
    payloadTruncated: false,
  });
}

async function world(db: Database): Promise<World> {
  const gate = await gateWorld(db);
  const [harness] = await db.execute<{ key: string }>(
    sql`SELECT key FROM harnesses WHERE id = ${gate.item.harnessId}`,
  );
  const key = harness?.key ?? '';
  const topic = `${key}/uw-platform#42`;
  await rewriteItem(db, gate.item.itemId, { zulipTopic: topic });
  return { ...gate, key, topic };
}

async function deliver(world: World, message: Message) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { traceId: randomUUID(), commit: 'test', route: 'queue ingest', principal: null },
    (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  const handler = zulipIngestHandler({
    db: world.db,
    kernel: kernelOn(world.db, clock),
    config,
    now: () => clock.now(),
  });
  const outcome = await handler(envelopeOf(message), logger);
  return { outcome, outcomes: lines.map((line) => line['outcome']), lines };
}

async function comments(db: Database) {
  const rows = await db.execute<{ item_id: string | null; evidence: Record<string, unknown> }>(
    sql`SELECT item_id, evidence FROM harness_events WHERE name = 'comment_recorded' ORDER BY position, at`,
  );
  return [...rows];
}

async function counted(db: Database, table: 'gate_decisions'): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
  );
  return row?.n ?? -1;
}

async function mappedAuthor(db: Database): Promise<void> {
  const w = await world(db);
  await seedPerson(db, { id: randomUUID(), email: 'reader@unfoldingword.org' });
  const sent = await deliver(w, { subject: w.topic, sender_email: 'Reader@UnfoldingWord.org' });
  expect(sent).toMatchObject({ outcome: 'handled', outcomes: ['comment_recorded'] });
  const [comment] = await comments(db);
  expect(comment?.item_id).toBe(w.item.itemId);
  expect(comment?.evidence).toMatchObject({ source: 'zulip', topic: w.topic, text: 'looks good' });
  expect(comment?.evidence['personId']).toEqual(expect.any(String));
  expect(JSON.stringify(sent.lines)).not.toContain('looks good');
}

async function unmappedAuthor(db: Database): Promise<void> {
  const w = await world(db);
  await deliver(w, { subject: w.topic });
  const [comment] = await comments(db);
  expect(comment?.evidence).toMatchObject({ personId: null, email: 'reader@partner.example' });
}

async function approveIsAComment(db: Database): Promise<void> {
  const w = await world(db);
  const before = await counted(db, 'gate_decisions');
  await deliver(w, { subject: w.topic, content: 'approve' });
  expect(await comments(db)).toHaveLength(1);
  expect(await counted(db, 'gate_decisions')).toBe(before);
  const [item] = await db.execute<{ gate_status: string }>(
    sql`SELECT gate_status FROM harness_items WHERE id = ${w.item.itemId}`,
  );
  expect(w.item.gateStatus).toBe('parked');
  expect(item?.gate_status).toBe('parked');
}

async function recordsNothing(db: Database): Promise<void> {
  const w = await world(db);
  const privateMessage = await deliver(w, { subject: '', type: 'private' });
  const otherChannel = await deliver(w, { subject: w.topic, display_recipient: '20-29 Other' });
  const unknownTopic = await deliver(w, { subject: 'nobody/x#1' });
  expect([privateMessage, otherChannel, unknownTopic].map((sent) => sent.outcomes)).toEqual([
    ['zulip_private_ignored'],
    ['zulip_channel_mismatch'],
    ['zulip_topic_unknown'],
  ]);
  expect(await comments(db)).toEqual([]);
}

async function harnessComment(db: Database): Promise<void> {
  const w = await world(db);
  await deliver(w, { subject: w.key });
  const [comment] = await comments(db);
  expect(comment?.item_id).toBeNull();
  expect(comment?.evidence['topic']).toBe(w.key);
}

describe.skipIf(!testServer)('Zulip replies become comments', () => {
  it('NT-3 a reply in the item topic is recorded on the item with its author mapped by email', () =>
    withAppDatabase(mappedAuthor));
  it('NT-3 a reply from an unmapped author is recorded with the email and no person', () =>
    withAppDatabase(unmappedAuthor));
  it('NT-3 a reply saying approve on a parked item is a comment and no gate decision exists', () =>
    withAppDatabase(approveIsAComment));
  it('a private message, a topic in another area channel and an unknown topic record nothing', () =>
    withAppDatabase(recordsNothing));
  it('a reply in the harness own topic is a harness-level comment', () =>
    withAppDatabase(harnessComment));
});
