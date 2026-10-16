import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { command, eventsNamed, softwareHarness } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';

async function fixClaimSwitch(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const byEditor = await command(db, scene.editor, scene.harnessId, 'set_fix_claim', {
    requestId,
    enabled: true,
  });
  expect(byEditor.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  const fresh = { requestId: randomUUID(), enabled: true };
  const byAdmin = await command(db, { email: IAN_EMAIL }, scene.harnessId, 'set_fix_claim', fresh);
  expect(byAdmin.body).toEqual({ status: 'accepted', requestId: fresh.requestId });
  const [set] = await eventsNamed(db, scene.harnessId, 'fix_claim_set');
  expect(set).toMatchObject({ evidence: { enabled: true }, requestId: fresh.requestId });
}

describe.skipIf(!testServer)('the fix claim switch', () => {
  it('FL-1 an admin turns the fix claim on through set_fix_claim; an editor is refused not_permitted', () =>
    withAppDatabase(fixClaimSwitch));
});
