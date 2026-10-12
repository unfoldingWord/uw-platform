# Step 9: Reaching a Person Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A wake reaches a person: after every committed transaction that appends a waking event, the kernel names who the wake is for, and the Notifier sends a content-free web push to each of their devices (ranked, cooled down per person, suppressed when they are already looking) and posts a content-free line to the item's Zulip topic; replies in that topic come back as comments on the item and never decide anything.

**Architecture:** The kernel (pure, `packages/harness/notify/`) turns the events a transaction appended into `Wake` values: the reason, the deep link, the Zulip topic and the recipients, each with a presence flag read from the live hub through the Hub port. The Notifier port carries one `Wake` and answers a `WakeDelivery`. The platform Notifier (`apps/uw-app/notify/`, owner of `push_subscriptions` and `push_cooldowns`) claims the person's cooldown window atomically in Postgres, sends Web Push through `@pushforge/builder` to every subscribed device, prunes expired ones, posts to Zulip over its REST API, and logs every decision with the wake's trace id. A first successful Zulip post records `zulip_topic_linked` on the item, so the topic is part of the fold. Zulip's outgoing webhook lands in `uw-ingest` (token checked, token stripped), goes through the queue, and becomes a `comment_recorded` event written by the ingest principal.

**Tech Stack:** TypeScript strict, Zod 4, Hono 4, Drizzle over Postgres, Cloudflare Workers and Durable Objects, `@pushforge/builder` 2.0.5 (Web Push, RFC 8291 and RFC 8292 on Web Crypto), Zulip REST API v1 over `fetch`, Vitest, PGlite in the sim.

**Spec:** `docs/PRD.md` (approved; no brainstorm, no approval step). Requirements covered: **NT-1, NT-2, NT-3, NT-4**. Decisions honoured: D2, P24, P25, P26, P31, P32. Carries planned here: NT-3 `zulip_topic` and the `notReplayed` constant (from step 3); NT-1 to NT-4 web push reuses the hub's presence (P24, from step 6). Plans on step 7 (the runs module, `run_failed`, the run host's kernel root, the one-minute cron) and step 8 (the Gates, item and Home views, the service worker, the WB-9 read) as built.

## Global Constraints

Every task obeys every line here. Copy exact values; do not paraphrase them in code.

- **Where:** the worktree `/home/ianjl/projects/uw-platform-v1`, branch `build/v1`. Implementers commit; they do not push (the controller pushes and watches CI).
- **Read before the first edit:** `AGENTS.md` sections 1, 4, 6 and 10; `CONTEXT.md` (Wake, Live hub, Cooldown, Waiting on you, Cursor, Principal, Delegation, Port, Adapter, Scenario, and the words Task 1 adds); `docs/exceptions.md`; `docs/architecture.md` sections on the live hub and on transactions and locks.
- **Verify, at the end of every task, green:** `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. If the local server is down: `/usr/lib/postgresql/16/bin/pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l ~/.local/share/uw-platform-test-pg.log start`. The local server is private; CI uses a Postgres service container. Run `pnpm format` before verify.
- **R37:** never run two test suites at once. No parallel `pnpm verify`, `pnpm test`, `vitest` or `pnpm sim:all`; wait for one to finish before starting another (concurrent suites kill the WSL VM).
- **DX-8:** no test, binding or job may need a live account or a secret. Web push is proven with a VAPID key pair and subscription keys generated in the test with Web Crypto and a fake `fetch`; Zulip with a fake `fetch` and recorded payloads. With any piece of configuration missing or malformed, the code answers `not_configured` for that channel and logs; it never throws at startup. Live runs are "Waiting on a person" rows in Task 9.
- **Production:** every new Worker variable goes in `infra/uw-app/wrangler.go-live.toml` or `infra/uw-ingest/wrangler.go-live.toml` only, never in a live `wrangler.toml`; secrets are never in any file. Each one gets a "Waiting on a person" row in Task 9.
- **Layering (dependency-cruiser and ESLint enforce it):** `packages/contracts` → nothing; `packages/core` → contracts; `packages/db` → contracts, core; `packages/harness` → contracts, core, pure (no Workers, Drizzle, vendor SDK or network); `apps/uw-app` → harness, db, contracts, core, ui; `sim/` → harness, contracts, db and the Node built-ins AGENTS.md lists. `@pushforge/builder` is imported only in `apps/uw-app/notify/push/transport.ts`. The `HARNESS_HUB` binding stays only in `apps/uw-app/env.ts` and `apps/uw-app/ports/hub.ts` (`tools/architecture/hub-wiring.test.ts`).
- **Code:** no comments of any kind (no line, block, JSDoc or directive comments, no commented-out code). Files under 500 lines; functions under 50 lines; ESLint fitness limits: 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. TypeScript strict, no `any`, no `@ts-ignore`.
- **Commits:** Conventional Commits. The body's last line lists the requirement IDs the commit proves or serves (for example `NT-1 NT-2`). No `Co-Authored-By` and no attribution footer of any kind. Hooks always pass; never `--no-verify`.
- **Shared roots** (`packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`): a change goes in its own commit with no feature code, and the message names the shared root and why it changed. Migrations travel with the `schema*.ts` commit that needs them.
- **Exceptions:** any exception to AGENTS.md rules 1 to 4 or section 10 gets its `docs/exceptions.md` row in the same commit as the code, written before it.
- **Contract version:** Task 1 moves `CONTRACT_VERSION` to the next major after the version it finds (`12.0.0` if it reads `11.x.y`; the major is required because `comment_recorded` evidence becomes a strict schema) and moves `contractVersion` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json` with it, with a new `contract-lock.json` entry. No later task changes `packages/contracts/`.
- **New closed values (Task 1):** event `zulip_topic_linked`; closed set `wake-reason` (`gate_waiting`, `delegation_lapsed`, `run_failed`, `stage_advanced`); closed set `live-screen` (`home`, `flow`, `board`, `gates`, `item`); ingest source `zulip`.
- **Notifications carry no content.** A push payload is exactly `{ harness, reason, link }` (`pushPayloadSchema`, strict). A Zulip post is the harness key, the item ref, one fixed sentence for the reason and the absolute link, nothing else: never a title, body, diff, finding, evidence, delegation id or person. No `@`-mention.
- **Only humans decide gates.** Nothing in this step writes `gate_decisions`, calls `kernel.gates`, or advances an item. A Zulip reply is a `comment_recorded` event and nothing else, whatever it says.
- **What an agent sees equals what it may act on** (R27, R32, R33); hidden equals missing (R28). A gate wake goes only to people who could decide it now (`admin` on the area and every domain grant the item's domains need). The push routes refuse agent principals.
- **Lock order** (`docs/architecture.md`): stage lock, then item rows (ascending id), then grants, then run rows, then appends; no lock after the first append. Transactions never nest. No port call (Notifier, Hub, GitHubFacts, Connectors, Runs, ModelEngine) inside a Store transaction: wakes are computed and sent only after the transaction that appended the events has committed.
- **One writer per table.** `push_subscriptions` and `push_cooldowns` are written only under `apps/uw-app/notify/push/` (`owns` in `apps/uw-app/notify/push/owns.ts`); `harness_items` and `harness_events` only by the kernel's record functions; `people` only by `apps/uw-app/people/directory.ts`.
- **A notification failure never fails the work that caused it.** A Notifier, Hub or Zulip failure after commit is caught; the command's outcome is unchanged. A failed send is not retried (P24).
- **R36 trace honesty:** a `describe`/`it`/`test` title that leads with a requirement ID must prove that requirement's clauses; supporting tests lead with no ID. Scenarios are `sim/scenarios/<ID>.<slug>.ts`.
- **Words:** "wake" (never alert, message or notification in names), "cooldown" (never debounce), "presence", "screen", "Zulip topic". Copy is sentence case, second person, no exclamation marks, no emoji; `unfoldingWord` is camelCase.

## Review Focus

The inputs the PRD implies but no single requirement names, most likely first. Each line's test lives in the task named.

1. **Sockets opened before this deploy carry no screen in their attachment:** the hub must keep them open (their tag parses with `screen: null`, `itemId: null`) and simply never count them as presence. A strict tag that fails to parse would close every live session on deploy. Test in Task 5.
2. **A push endpoint that is not a push service** (`https://169.254.169.254/…`, `http://fcm.googleapis.com/…`, `https://evil.example/fcm.googleapis.com`): refused `malformed_command` at subscribe, so the Worker never posts a signed request to an arbitrary host. Test in Task 6.
3. **Two wakes for one person in the same instant on two connections:** exactly one claims the cooldown window and sends; the other is `coalesced`. Test in Task 6 (two-connection Postgres test).
4. **A Zulip reply in a topic named like a harness's but in another area's channel, or a private message to the bot, or a reply saying "approve" on a parked item:** nothing is recorded for the first two; the third is one `comment_recorded` and the item is still parked with no `gate_decisions` row. Test in Task 8.
5. **A wake for the person who caused it:** a person who submits their own item to a gate they could decide is not woken for it (the actor's own person is excluded only when the actor is `human:<that person>`; an agent acting for them still wakes them). Test in Task 3.

## Decisions this plan makes

Choices the PRD, the spec and AGENTS.md leave open. Task 9 copies each into `docs/progress_tracker.md` "Decisions made during the build" with the cost if wrong.

| # | Decision | Cost if wrong |
|---|---|---|
| S9-D1 | Contract 12.0.0 (major, because `comment_recorded` gains strict evidence where it accepted any object): event `zulip_topic_linked` `{ topic }`; `comment_recorded` `{ source: 'zulip', messageId, topic, personId, email, text, truncated }`; closed sets `wake-reason` and `live-screen`; ingest source `zulip`; `deepLinkSchema` with `gateLink`, `itemLink`, `homeLink`; `pushPayloadSchema`; `pushSubscribeSchema`, `pushUnsubscribeSchema`; `zulipTopicSchema`; `zulipOutgoingSchema` | None: no external consumer yet |
| S9-D2 | Wakes are computed by the kernel after the transaction that appended the events commits (`wakingStore` gains an after-commit hook), one `Wake` per triggering event, sent in rank order (strongest first). Triggers: `submitted_to_gate` with `result: 'parked'` → `gate_waiting`; `delegation_lapsed` → `delegation_lapsed`; `run_failed` → `run_failed`; `stage_advanced` → `stage_advanced`. Any failure after commit is swallowed by the kernel; the platform Notifier logs its own | A planning failure (a read after commit fails) loses that wake silently on the kernel side |
| S9-D3 | Recipients. `gate_waiting`: every active person whose grants give `admin` on the harness's area and cover every domain of the item (`approverCovers`). `delegation_lapsed`: the delegation's person if they still hold `admin` on the area, else every other person holding `admin` on the area. `run_failed`: the person behind the item's holder just before the failing transaction, else the run's delegation's person, else the device owner of the run's persona identity. `stage_advanced`: the person behind the holder just before the transaction (P24: the holder only), none if the item was not held. A person is excluded from a wake caused by their own `human:<personId>` actor | A person who wants a wake for their own action gets none |
| S9-D4 | Ranks: `gate_waiting` 3, `delegation_lapsed` 3, `run_failed` 2, `stage_advanced` 1. Cooldown (P24, 10 minutes per person): a wake is sent when no window is open or it outranks the open window's rank; sending opens a new window at that instant and rank. The window is claimed atomically before sending; a send that then fails still spends it (P24: not retried). A suppressed wake or one with no device spends nothing | A burst of equal-rank gates in ten minutes reaches the phone once; Home and Zulip still show each |
| S9-D5 | Presence (P24): the hub tags each socket with the screen and item its view connected for (`GET /api/harness/:harness/live?screen=<live-screen>&item=<uuid>`); a person is present for a wake when one of their open sockets on that harness has the wake's screen (`gate_waiting` → `gates`; `run_failed`, `stage_advanced` → `item` with the same item; `delegation_lapsed` → `home`). A presence read that fails or times out (2 s) is "not present" | A failed presence read sends a push the person did not need |
| S9-D6 | Deep links: `/harness/<harnessId>/gates/<itemId>` (gate), `/harness/<harnessId>/items/<itemId>` (run failed, stage advanced), `/` (lapsed delegation; Home at the app root, P31). Task 1 Step 0 aligns these with step 8's page routes before anything is written | A route renamed later needs a contract change |
| S9-D7 | Web push uses `@pushforge/builder` 2.0.5 (`buildPushHTTPRequest`) with `VAPID_PRIVATE_JWK` (secret, JWK JSON), `VAPID_PUBLIC_KEY` (variable, base64url, 87 characters) and `VAPID_SUBJECT` (variable, `mailto:` or `https:`); TTL 3600 s; urgency `high` for rank 3 and `normal` otherwise; each send bounded at 5 s; subscriptions are keyed by endpoint, at most 20 per person (a 21st replaces the oldest), pruned on a 404 or 410 answer and when their `expirationTime` has passed. Endpoints must be `https:` on `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com` or a host ending `.notify.windows.com` | A browser on another push service cannot subscribe until the list grows |
| S9-D8 | Subscriptions are managed at `GET /api/push/key`, `POST /api/push/subscriptions` and `POST /api/push/subscriptions/remove`, person principals only (agents `not_permitted`), touching only the caller's own rows; recorded in `docs/exceptions.md` beside `/api/me` (no area to scope `can()` to) | None known |
| S9-D9 | Zulip out: `POST <ZULIP_SITE>/api/v1/messages` with basic auth `ZULIP_BOT_EMAIL:ZULIP_BOT_API_KEY`, `type=stream`, the channel from `ZULIP_CHANNELS` (a JSON object, area → channel name), bounded at 5 s. Only `gate_waiting`, `run_failed` and `delegation_lapsed` post (P25). Topic `<harness key>/<item ref>` (item ref `<repository name>#<number>` for a wrapped issue, else `item-<first 8 hex of the item id>`), cut to 60 characters; a harness-level lapse posts to the topic `<harness key>`. Content: ``<harness key> · <item ref>: <sentence>. <APP_ORIGIN><link>`` | An area with no channel in the map drops its Zulip wakes (logged `zulip_channel_unmapped`) |
| S9-D10 | The topic is linked by a `zulip_topic_linked` event, recorded by the kernel as `agent:system` after the first successful post for an item whose `zulipTopic` is null; the fold sets `zulipTopic`; the `notReplayed` constant and its uses are removed, so replay equals the row in every field | None: no row holds a topic yet |
| S9-D11 | Zulip in: the bot's outgoing webhook (Zulip calls it when the bot is @-mentioned in a stream or sent a private message). `uw-ingest` compares the payload `token` with `ZULIP_WEBHOOK_TOKEN` in constant time (SHA-256 of both, byte compare), strips `token` before enqueueing, and uses `zulip:<message id>` as the delivery id. The queue handler ignores private messages, finds the target from the topic, requires the message's channel to be the target harness's area channel, maps `sender_email` to an active `people` row (or null, P25), and records `comment_recorded` (text cut to 10 000 characters with `truncated: true`). The answer has no `content`, so the bot never replies | A reply that does not @-mention the bot is not recorded |
| S9-D12 | The after-commit wake is awaited inside the command, MCP call, queue batch or cron run that appended the events (each send bounded at 5 s, sends in parallel) | A parked submit answers up to ~5 s slower when a push service or Zulip is slow |
| S9-D13 | The sim notifier runs the same rank and cooldown function as the platform one; it has no devices and Zulip off until a scenario calls `subscribe` or `enableZulip`, so earlier scenarios' event logs are unchanged | None |
| S9-D14 | A queue retry after a comment was recorded but before the ack records the comment twice (the delivery ledger stops redeliveries, not retries) | A rare duplicate comment on the play-by-play |

---

### Task 1: Contracts 12.0.0, the notifier tables, and the words

**Requirements served:** NT-1, NT-2, NT-3, NT-4 (contract, schema and vocabulary only; proven by later tasks). Supporting tests lead with no ID except the NT-2 payload test, which proves NT-2's "a contract test rejects any payload with a content field".

**Files:**
- Create: `packages/contracts/notify.ts`, `packages/contracts/notify.test.ts`, `packages/contracts/zulip.ts`, `packages/contracts/zulip.test.ts`
- Create fixtures: `packages/contracts/fixtures/{wake-reason,live-screen,deep-link,push-payload,push-subscribe,push-unsubscribe,zulip-topic,zulip-outgoing}/{valid,invalid}/*.json`
- Modify: `packages/contracts/closed-sets.ts`, `packages/contracts/events.ts`, `packages/contracts/event-evidence.ts`, `packages/contracts/ingest.ts`, `packages/contracts/index.ts`, `packages/contracts/registry.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/fixtures/event/{valid,invalid}/` (one valid `zulip_topic_linked`, one valid and one invalid `comment_recorded`), `apps/uw-app/package.json`, `apps/uw-ingest/package.json`
- Modify (callers of the tightened evidence): `tools/properties/item-events.ts` (emit valid `comment_recorded` evidence), `packages/harness/items/fold.test.ts` (the `comment_recorded` case uses valid evidence)
- Create: `packages/db/schema-notify.ts`; Modify: `packages/db/schema.ts` (`export * from './schema-notify.ts'`), `packages/db/harness-tables.test.ts` or a new `packages/db/notify-tables.test.ts`
- Create: `packages/db/migrations/<next>_notify.sql` (generated) and its `meta/` entry
- Modify: `CONTEXT.md`

**Interfaces:**
- Produces (from `@uw/contracts`): `wakeReasonSchema`, `WakeReason`, `liveScreenSchema`, `LiveScreen`, `deepLinkSchema`, `DeepLink`, `gateLink(harnessId, itemId)`, `itemLink(harnessId, itemId)`, `homeLink`, `pushPayloadSchema`, `PushPayload`, `pushEndpointSchema`, `pushSubscribeSchema`, `PushSubscribe`, `pushUnsubscribeSchema`, `zulipTopicSchema`, `zulipOutgoingSchema`, `zulipMessageSchema` (the outgoing payload without `token`), `ZulipOutgoing`, `ZulipMessage`, `ZULIP_TEXT_LIMIT` (10 000), event name `zulip_topic_linked`, `EventEvidence['comment_recorded']`, ingest source `'zulip'`.
- Produces (from `@uw/db/schema`): `pushSubscriptions`, `pushCooldowns`.

- [ ] **Step 0: Align the deep links with step 8's page routes.** Run `grep -rn "'/harness/:harness" apps/uw-app` and read step 8's plan under `docs/superpowers/plans/` if present. If step 8 serves the Gates view for one gate and the item play-by-play at paths other than `/harness/:harness/gates/:item` and `/harness/:harness/items/:item`, use step 8's paths in `gateLink`, `itemLink` and `deepLinkSchema` below and say so in the commit body. Home is `/` (P31).

- [ ] **Step 1: Write the failing contract tests** in `packages/contracts/notify.test.ts` and `packages/contracts/zulip.test.ts`:
  - `NT-2 the push payload names the harness, the reason and a deep link and nothing else`: `pushPayloadSchema` accepts `{ harness: 'software', reason: 'gate_waiting', link: gateLink(h, i) }`; rejects the same object plus each of `content`, `body`, `title`, `text`, `itemId`, `delegationId`, `findings`, `diff` (one `it.each` row each); rejects a link to `/api/…`, an absolute URL, a link with a query string and a link whose segments are not UUIDs.
  - `the deep link builders produce links the schema accepts` for `gateLink`, `itemLink`, `homeLink`.
  - `a push endpoint must be https on a known push service`: accepts `https://fcm.googleapis.com/fcm/send/abc`, `https://updates.push.services.mozilla.com/wpush/v2/abc`, `https://web.push.apple.com/abc`, `https://db5p.notify.windows.com/w/?token=abc`; rejects `http://fcm.googleapis.com/x`, `https://169.254.169.254/x`, `https://evil.example/fcm.googleapis.com`, `https://fcm.googleapis.com.evil.example/x`, a 2 049-character URL.
  - `a subscription carries an endpoint and the two keys of the right length`: `p256dh` 87 base64url characters, `auth` 22, `expirationTime` a non-negative integer or null; extra keys rejected.
  - `comment_recorded evidence is typed`: the valid fixture parses; `{}` and a `personId` that is not a UUID are rejected (through `newEventSchema`).
  - `zulip_topic_linked carries one topic of at most 60 characters with no line break`.
  - `a Zulip outgoing payload parses with unknown fields kept out of the result's required shape`: `zulipOutgoingSchema` parses a recorded-shape payload (token, trigger `mention`, `message` with `id`, `sender_email`, `type: 'stream'`, `display_recipient: '80-89 Technology'`, `subject`, `content`, plus fields Zulip adds such as `timestamp`); `zulipMessageSchema` is the same without `token`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run packages/contracts/notify.test.ts packages/contracts/zulip.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Write the contracts.** In `packages/contracts/closed-sets.ts` add:

```ts
export const wakeReasonSchema = z.enum([
  'gate_waiting',
  'delegation_lapsed',
  'run_failed',
  'stage_advanced',
]);
export const liveScreenSchema = z.enum(['home', 'flow', 'board', 'gates', 'item']);
export type WakeReason = z.infer<typeof wakeReasonSchema>;
export type LiveScreen = z.infer<typeof liveScreenSchema>;
```

`packages/contracts/notify.ts`:

```ts
import { z } from 'zod';
import { wakeReasonSchema } from './closed-sets.ts';
import { slugSchema } from './pages.ts';

const uuidPart = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const deepLinkPattern = new RegExp(`^/(?:harness/${uuidPart}/(?:gates|items)/${uuidPart})?$`);

export const deepLinkSchema = z.string().max(100).regex(deepLinkPattern);
export type DeepLink = z.infer<typeof deepLinkSchema>;

export const homeLink: DeepLink = '/';
export function gateLink(harnessId: string, itemId: string): DeepLink {
  return deepLinkSchema.parse(`/harness/${harnessId}/gates/${itemId}`);
}
export function itemLink(harnessId: string, itemId: string): DeepLink {
  return deepLinkSchema.parse(`/harness/${harnessId}/items/${itemId}`);
}

export const pushPayloadSchema = z.strictObject({
  harness: slugSchema,
  reason: wakeReasonSchema,
  link: deepLinkSchema,
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

const pushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

function knownPushHost(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;
  return pushHosts.has(url.hostname) || url.hostname.endsWith('.notify.windows.com');
}

export const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine(knownPushHost, 'not an https endpoint on a known push service');

export const pushSubscribeSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  expirationTime: z.number().int().min(0).nullable(),
});
export type PushSubscribe = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.strictObject({ endpoint: pushEndpointSchema });
export type PushUnsubscribe = z.infer<typeof pushUnsubscribeSchema>;
```

`packages/contracts/zulip.ts`:

```ts
import { z } from 'zod';

export const ZULIP_TEXT_LIMIT = 10_000;

export const zulipTopicSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => !/[\r\n]/.test(value) && value.trim() === value, 'one trimmed line');

const message = z.object({
  id: z.number().int().min(1).max(2 ** 48),
  sender_email: z.string().min(3).max(254),
  type: z.enum(['stream', 'private']),
  display_recipient: z.union([z.string().max(200), z.array(z.unknown())]),
  subject: z.string().max(200),
  content: z.string(),
});

export const zulipOutgoingSchema = z.object({
  token: z.string().min(1).max(200),
  trigger: z.string().min(1).max(50),
  message,
});
export const zulipMessageSchema = zulipOutgoingSchema.omit({ token: true });
export type ZulipOutgoing = z.infer<typeof zulipOutgoingSchema>;
export type ZulipMessage = z.infer<typeof zulipMessageSchema>;
```

In `events.ts` add `'zulip_topic_linked'` after `'comment_recorded'`. In `event-evidence.ts` add to `itemEvidence`:

```ts
  zulip_topic_linked: z.strictObject({ topic: zulipTopicSchema }),
```

and to `harnessEvidence` (it may be item-level or harness-level, like other harness events that carry an optional item):

```ts
  comment_recorded: z.strictObject({
    source: z.literal('zulip'),
    messageId: z.number().int().min(1),
    topic: zulipTopicSchema,
    personId: id.nullable(),
    email: z.string().min(3).max(254),
    text: z.string().max(ZULIP_TEXT_LIMIT),
    truncated: z.boolean(),
  }),
```

In `ingest.ts`: `ingestSourceSchema = z.enum(['github', 'zulip'])`. Register every new schema in `registry.ts` under the fixture directory names listed in **Files**; export everything from `index.ts`. Bump `version.ts` and both `contractVersion` pins; append the lock entry (`pnpm vitest run packages/contracts/contract-lock.test.ts` prints the sets to copy). Write the fixtures (each `valid/` and `invalid/` holds at least one file). Update `tools/properties/item-events.ts` to emit `comment_recorded` with valid evidence and `packages/harness/items/fold.test.ts`'s case likewise.

- [ ] **Step 4: Run the contract tests.** Run: `pnpm vitest run packages/contracts`. Expected: PASS.

- [ ] **Step 5: Commit the contracts alone.**

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json tools/properties/item-events.ts packages/harness/items/fold.test.ts
git commit -m "feat(contracts)!: contract 12.0.0, wake reasons, deep links, the push payload and subscription, Zulip topics and comments

Shared root packages/contracts: NT-1 to NT-4 need a content-free push payload,
the subscription body, the live screen a session watches, the topic event and
typed reply comments. comment_recorded evidence becomes strict, so the major moves.

NT-1 NT-2 NT-3 NT-4"
```

- [ ] **Step 6: Write the failing schema test** `packages/db/notify-tables.test.ts`: `push_subscriptions` and `push_cooldowns` are declared with classification `restricted`/`never` and `internal`/`never`; a cooldown rank of 0 or 4 is refused by Postgres; a subscription for an unknown person is refused (foreign key); `harness_events` accepts `zulip_topic_linked`; `webhook_deliveries` accepts source `zulip`. Use the existing embedded-database test helpers the other `packages/db/*.test.ts` files use.

- [ ] **Step 7: Write the schema** `packages/db/schema-notify.ts`:

```ts
import { sql } from 'drizzle-orm';
import { check, index, integer, text, uuid } from 'drizzle-orm/pg-core';
import { declareTable } from './declarations.ts';
import { instant } from './columns.ts';
import { people } from './schema-platform.ts';

export const pushSubscriptions = declareTable(
  'push_subscriptions',
  {
    endpoint: text('endpoint').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    expiresAt: instant('expires_at'),
    createdAt: instant('created_at').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    index('push_subscriptions_person').on(t.personId, t.createdAt),
    check('push_subscriptions_endpoint_https', sql`${t.endpoint} LIKE 'https://%'`),
  ],
);

export const pushCooldowns = declareTable(
  'push_cooldowns',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => people.id),
    windowStartedAt: instant('window_started_at').notNull(),
    rank: integer('rank').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [check('push_cooldowns_rank_known', sql`${t.rank} BETWEEN 1 AND 3`)],
);
```

(Match the real import paths of `declareTable` and `instant`; copy them from `schema-platform.ts`.) Re-export from `schema.ts`. Run `pnpm db:generate`, rename the file to `<NNNN>_notify.sql` with the next free number and fix the journal entry the way earlier migrations did; it must also rewrite the `harness_events_name_known` and `webhook_deliveries_source_known` checks from the contract (drop then add, as `0023_contract_11_checks.sql` does).

- [ ] **Step 8: Run the db tests.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db`. Expected: PASS.

- [ ] **Step 9: Commit the schema alone.**

```bash
git add packages/db
git commit -m "feat(db): push_subscriptions, push_cooldowns, and the checks for contract 12.0.0

Shared root packages/db/schema-notify.ts: the notifier's two tables (PRD 8.1)
and the event-name and ingest-source checks the new contract needs.

NT-1 NT-3"
```

- [ ] **Step 10: Add the words to `CONTEXT.md`** under "Reaching a person": **Presence** (a person's open live session on one screen of a harness; a wake for that screen is suppressed; _Avoid_: online, active), **Screen** (the view a live session watches: `home`, `flow`, `board`, `gates`, `item`), **Zulip topic** (the one topic per item, `<harness key>/<item ref>`, named on the item by `zulip_topic_linked`; _Avoid_: thread, stream), **Item ref** (`<repository name>#<number>` for a wrapped issue, else `item-<first 8 hex of the item id>`), **Device** if not already defined for push (a browser install holding one push subscription). Commit alone:

```bash
git add CONTEXT.md
git commit -m "docs(context): presence, screen, Zulip topic and item ref

Shared root CONTEXT.md: the words step 9 names modules and tests with.

NT-1 NT-3"
```

- [ ] **Step 11: Verify.** Run the verify command from Global Constraints. Expected: green.

---

### Task 2: The ports: a wake with recipients, the delivery, hub presence, and the area's grant holders

**Requirements served:** NT-1, NT-2 (port shapes and their contracts; behaviour proven in Tasks 3 and 6). Contract-suite titles lead with `DX-3`, as every port contract does.

**Files:**
- Modify: `packages/harness/ports.ts` (shared root, own commit)
- Modify: `packages/harness/port-contracts/notifier.ts`, `packages/harness/port-contracts/hub.ts`, `packages/harness/port-contracts/grants.ts`
- Modify: `sim/adapters/notifier.ts`, `sim/adapters/notifier.contract.test.ts`, `sim/adapters/hub.ts`, `sim/adapters/hub.contract.test.ts`, `sim/adapters/grants.ts` (only if it does not already bind `createDrizzleGrants`)
- Modify: `packages/db/store/grants.ts` (`holders`), `apps/uw-app/ports/grants.ts`, `apps/uw-app/ports/grants.not-wired.ts`, `apps/uw-app/ports/hub.ts` (`present` stub answering `false` until Task 5), `apps/uw-app/ports/hub.not-wired.ts`, `apps/uw-app/unit-hub.ts` (pass `present` through), `packages/harness/hub-wakes.ts` (`wakingGrants` passes `holders`), and every test double of `Hub`, `Grants` or `Notifier` that `pnpm typecheck` names (for example `packages/harness/kernel.test.ts`, `apps/uw-app/kernel.test.ts`, `apps/uw-app/testing/*.ts`, `apps/uw-app/live/testing.ts`)
- Create: `packages/harness/notify/rank.ts`, `packages/harness/notify/rank.test.ts`

**Interfaces:**
- Produces in `packages/harness/ports.ts` (replacing the step-2 `WakeReason`, `Wake`, `NotifyOutcome`, `Notifier`, `Hub`):

```ts
export type { WakeReason, LiveScreen, DeepLink } from '@uw/contracts';

export type PresenceQuery = {
  readonly harnessId: string;
  readonly personId: string;
  readonly screen: LiveScreen;
  readonly itemId: string | null;
};
export type Hub = {
  wake(harnessId: string): Promise<void>;
  present(query: PresenceQuery): Promise<boolean>;
};

export type WakeRecipient = { readonly personId: string; readonly present: boolean };
export type Wake = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly jdArea: JdArea;
  readonly itemId: string | null;
  readonly itemRef: string | null;
  readonly topic: string;
  readonly reason: WakeReason;
  readonly link: DeepLink;
  readonly recipients: readonly WakeRecipient[];
  readonly at: Date;
  readonly traceId: string;
};
export type PushDecision =
  | 'sent'
  | 'coalesced'
  | 'suppressed'
  | 'no_device'
  | 'dropped'
  | 'not_configured';
export type ZulipDecision = 'posted' | 'not_posted' | 'dropped' | 'not_configured';
export type WakeDelivery = {
  readonly push: readonly { readonly personId: string; readonly decision: PushDecision }[];
  readonly zulip: ZulipDecision;
};
export type Notifier = { notify(wake: Wake): Promise<WakeDelivery> };

export type GrantHolder = {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
};
export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  resolveIn(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  holders(area: JdArea, at: Date): Promise<readonly GrantHolder[]>;
};
```

- Produces in `packages/harness/notify/rank.ts` (exported from `@uw/harness`):

```ts
import type { WakeReason } from '@uw/contracts';

export const COOLDOWN_MS = 600_000;
export const POSTING_REASONS: ReadonlySet<WakeReason> = new Set([
  'gate_waiting',
  'delegation_lapsed',
  'run_failed',
]);
export const wakeRank: Readonly<Record<WakeReason, 1 | 2 | 3>> = {
  gate_waiting: 3,
  delegation_lapsed: 3,
  run_failed: 2,
  stage_advanced: 1,
};
export type CooldownWindow = { readonly startedAt: Date; readonly rank: number };
export type CooldownChoice =
  | { readonly decision: 'send'; readonly window: CooldownWindow }
  | { readonly decision: 'coalesce' };

export function chooseInWindow(
  window: CooldownWindow | null,
  reason: WakeReason,
  at: Date,
): CooldownChoice {
  const rank = wakeRank[reason];
  const open = window !== null && at.getTime() - window.startedAt.getTime() < COOLDOWN_MS;
  if (open && rank <= window.rank) return { decision: 'coalesce' };
  return { decision: 'send', window: { startedAt: at, rank } };
}
```

- `Grants.holders(area, at)` answers every person with `people.status = 'active'` holding at least one live grant (unrevoked, unexpired at `at`) at `org` scope or at `jd_area` scope on `area`, each with the email and all of that person's live grants (any scope), ordered by person id. It refuses with `CallOutsideOpenTransactionError` inside an open transaction, like `resolve`.
- Sim Hub: `createSimHub()` gains `enter(query: PresenceQuery): void` and `leave(query: PresenceQuery): void`; `present` answers whether an equal query was entered and not left (for `screen !== 'item'` the item id is ignored).
- Sim Notifier (`createSimNotifier(): SimNotifier`): keeps `delivered(): readonly Wake[]`, `failNext(): void`, and gains `subscribe(personId: string): void`, `enableZulip(): void`, `decisions(): readonly { traceId: string; personId: string; decision: PushDecision }[]`, `posts(): readonly { topic: string; reason: WakeReason; traceId: string }[]`. Its `notify`: for each recipient in order, `present` → `suppressed`; else no subscription → `no_device`; else `chooseInWindow` over its in-memory window for that person → `coalesced`, or `sent` (or `dropped` when `failNext` was armed) with the window stored. Zulip: `not_configured` until `enableZulip`, `not_posted` when the reason is not in `POSTING_REASONS`, `dropped` when `failNext` was armed, else `posted` and recorded. `failNext` arms one failure for the next `notify` call (push sends and the post).

- [ ] **Step 1: Write the failing tests.**
  - `packages/harness/notify/rank.test.ts`: `a weaker wake never spends the window a stronger one needs` — no window: send; `stage_advanced` sent at t, then `gate_waiting` at t+1 min: send; `gate_waiting` at t, then `gate_waiting` at t+9 min 59 s: coalesce; at t+10 min: send; `run_failed` inside a rank-3 window: coalesce; `gate_waiting` inside a rank-2 window: send and the new window starts at that instant with rank 3.
  - Rewrite `describeNotifierContract` in `packages/harness/port-contracts/notifier.ts`. `NotifierSubject` becomes `{ notifier; subscribe(personId): Promise<void>; enableZulip(): Promise<void>; failNext(): Promise<void>; posts(): Promise<readonly { topic: string; reason: WakeReason }[]> }`. Cases under `DX-3 notifier port contract on ${adapter}`: a subscribed recipient is `sent`; a present recipient is `suppressed` and spends nothing (a second identical wake for them, not present, is `sent`); an equal-rank wake inside ten minutes is `coalesced`, a stronger one is `sent`, one at ten minutes is `sent`; a recipient with no device is `no_device`; a `gate_waiting` wake posts once to its topic whatever the recipient count (including none), a `stage_advanced` wake answers `not_posted`; with Zulip off the answer is `not_configured`; an armed failure answers `dropped` for push and Zulip, and the next wake is `sent` (no retry). Build each wake with `at` advanced by the test, never the wall clock.
  - `describeHubContract`: add `present answers false with no session and true for the person, screen and item that connected`, and `an item screen session is presence for that item only`. `HubSubject` gains `enter(query): Promise<void>`.
  - `describeGrantsContract`: add `holders lists every active person with a live grant on the area or the org, with all their live grants`: an org admin, an area editor, an expired area admin (absent), a revoked grant (absent), an admin on another area (absent), a pending person with a grant (absent); and `holders refuses inside an open transaction`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run packages/harness/notify sim/adapters`. Expected: FAIL (types and members missing).

- [ ] **Step 3: Change `packages/harness/ports.ts`** to the shapes in **Interfaces** (import `Grant`, `JdArea`, `LiveScreen`, `WakeReason`, `DeepLink` from `@uw/contracts`). Commit it alone after Step 5 passes, first in the task's commit sequence:

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the wake carries its recipients and topic, the notifier answers a delivery, the hub answers presence, grants list an area's holders

Shared root packages/harness/ports.ts: NT-1 needs ranked, cooled and suppressed
sends per person and one Zulip post per wake; P24 puts presence on the live hub;
NT-2 needs everyone who could decide a gate. WakeReason now comes from the contract.

NT-1 NT-2"
```

- [ ] **Step 4: Implement** `rank.ts`; `holders` in `packages/db/store/grants.ts` (two queries: the distinct qualifying person ids joined to `people` for `status = 'active'` and the email, then `resolveGrants` for each, or one query over `role_grants` for those ids grouped in code; wrap with `outsideOpenTransaction(db, 'grants.holders', …)`); the platform and not-wired Grants adapters; `wakingGrants` passing `holders` through; the sim Hub and sim Notifier as specified; `present` on `apps/uw-app/ports/hub.ts` answering `false` (Task 5 replaces it), on the not-wired hub through `notWiredCall('hub', 'present')`, on `unitHub` straight to its target; the not-wired Notifier unchanged in shape. Fix every test double `pnpm typecheck` reports.

- [ ] **Step 5: Run the tests.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/harness sim/adapters apps/uw-app/ports packages/db/store`. Expected: PASS.

- [ ] **Step 6: Commit the adapters and rank** (after the ports commit):

```bash
git add packages/harness/notify packages/harness/port-contracts packages/harness/hub-wakes.ts packages/harness/index.ts packages/db/store sim/adapters apps/uw-app
git commit -m "feat(harness): the wake rank and cooldown choice; the sim notifier, sim hub presence and grant holders on both targets

NT-1 NT-2"
```

- [ ] **Step 7: Verify.** Run the verify command. Expected: green.

---

### Task 3: The kernel computes wakes after commit: who, why, where it links, and whether they are already looking

**Requirements proven:** NT-1 (candidate wakes per person, ranked, cooldown, presence, every device — through the sim notifier), NT-2 (a gate wake reaches only people who can decide it; the link is a deep link), NT-4 (lapsed delegation and final run failure recipients and ranks; a retried step sends nothing; both appear on Home and the play-by-play). Closes the P24 carry's kernel half.

**Files:**
- Create: `packages/harness/notify/triggers.ts`, `packages/harness/notify/recipients.ts`, `packages/harness/notify/plan.ts`, `packages/harness/notify/after-commit.ts`, `packages/harness/notify/topic.ts` (only `itemRefOf` and `topicFor` in this task; Task 4 adds `linkTopic`)
- Create tests: `packages/harness/notify/triggers.test.ts`, `packages/harness/notify/recipients.test.ts`
- Modify: `packages/harness/hub-wakes.ts` (`wakingStore` gains the after-commit hook), `packages/harness/kernel.ts`, `packages/harness/index.ts`
- Create scenarios: `sim/scenarios/NT-1.a-gate-wake-is-ranked-cooled-and-suppressed.ts`, `sim/scenarios/NT-2.a-gate-wake-reaches-only-who-can-decide.ts`, `sim/scenarios/NT-4.a-lapse-and-a-final-failure-wake-their-people.ts`
- Create test: `sim/kernel/wakes.test.ts`

**Interfaces:**
- Consumes: Task 2's `Wake`, `WakeRecipient`, `Hub.present`, `Grants.holders`, `Notifier`, `wakeRank`; `approverCovers` (`packages/harness/risk/domain-grants.ts`); `allowed`/`can`; `personPrincipal` (`@uw/core/principal`); `foldItem`, `readAllEvents`; `gateLink`, `itemLink`, `homeLink` (`@uw/contracts`); `deviceOwnerSegment`, `delegationIdOf` (`@uw/contracts`).
- Produces:

```ts
export type Trigger = { readonly event: HarnessEvent; readonly reason: WakeReason };
export function triggersOf(events: readonly HarnessEvent[]): readonly Trigger[];

export function itemRefOf(item: Pick<ItemState, 'itemId' | 'issue'>): string;
export function topicFor(harnessKey: string, itemRef: string | null): string;

export function personBehind(
  identity: Identity | null,
  delegationPerson: (delegationId: string) => string | null,
): string | null;
export function deciders(
  holders: readonly GrantHolder[],
  harness: Pick<Harness, 'jdArea'>,
  item: Pick<ItemState, 'riskDomains'>,
  at: Date,
): readonly string[];
export function areaAdmins(
  holders: readonly GrantHolder[],
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): readonly string[];

export type WakePlanPorts = Pick<Ports, 'store' | 'grants' | 'hub' | 'clock'>;
export function planWakes(ports: WakePlanPorts, events: readonly HarnessEvent[]): Promise<readonly Wake[]>;

export type AfterCommit = (events: readonly HarnessEvent[]) => Promise<void>;
export function notifyCommitted(ports: Ports): AfterCommit;
export function wakingStore(store: Store, hub: Hub, afterCommit?: AfterCommit): Store;
```

- Rules (exact):
  - `triggersOf`: `submitted_to_gate` whose evidence `result === 'parked'` → `gate_waiting`; `delegation_lapsed` → `delegation_lapsed`; `run_failed` → `run_failed`; `stage_advanced` → `stage_advanced`; every other event → nothing. Output sorted by `wakeRank` descending, then by `position`.
  - `itemRefOf`: an item with `issue` → `<repository name after the slash>#<number>`; else `item-<itemId.slice(0, 8)>`. `topicFor(key, ref)`: `ref === null ? key : \`${key}/${ref}\``, cut to 60 characters, trailing spaces trimmed; the result must parse with `zulipTopicSchema`.
  - `personBehind`: `human:<id>` → id; `agent:<person>/<device>` (with or without ` as … via delegation:…`) → `deviceOwnerSegment`; a bare `agent:<persona> … via delegation:<id>` → the delegation's person; anything else → null.
  - `deciders`: holders whose `personPrincipal({ personId, email, grants, interactive: true })` has `admin` on `{ kind: 'area', area: harness.jdArea }` at `at` and `approverCovers(principal, harness.jdArea, item.riskDomains, at)`.
  - `areaAdmins`: holders with `admin` on the area at `at`.
  - Recipients per reason: S9-D3. The holder "just before the transaction" is `foldItem` over the item's events whose `position` is below the lowest position among this batch's events for that item (read with `readAllEvents`). Exclude the person `personBehind(actor)` only when the triggering event's actor is `human:<that person>`. Deduplicate; order by person id.
  - Links: `gate_waiting` → `gateLink`; `run_failed`, `stage_advanced` → `itemLink`; `delegation_lapsed` → `homeLink`. Screens for presence: `gates` (item id null), `item` (the item id), `home` (item id null).
  - `topic`: item wakes → the item's stored `zulipTopic` if not null, else `topicFor(harness.key, itemRefOf(item))`; harness-level (`delegation_lapsed` with `itemId` null) → `topicFor(harness.key, null)`; `itemRef` null for harness-level.
  - `planWakes` reads in one read-only Store transaction (harness, items, item events, runs, delegations), then calls `grants.holders(harness.jdArea, at)` outside it (once per harness per batch), then `hub.present` for each recipient outside it; a `present` that throws counts as `false`. `at` is `clock.now()` read once.
  - `notifyCommitted(ports)`: returns at once (no reads) when `triggersOf(events)` is empty; otherwise `planWakes`, then `notifier.notify(wake)` for each wake in order, each in its own `try/catch`. Any throw anywhere is caught; nothing propagates. Task 4 adds the topic link after a `posted` delivery.
  - `wakingStore(store, hub, afterCommit)`: collects the events every `append` in the transaction returned; after the transaction commits, wakes the hub per harness as today, then awaits `afterCommit(events)` inside a `try/catch`. Not called when the transaction throws.
  - `createKernel` wires `wakingStore(ports.store, ports.hub, notifyCommitted(live))` where `live` is the kernel's wrapped ports (so a later topic-link transaction also wakes the hub).

- [ ] **Step 1: Write the failing tests and scenarios.**
  - `triggers.test.ts` (no ID): the four triggers and their order; `submitted_to_gate` with `advanced` or `checks_failed` triggers nothing; `zulip_topic_linked`, `comment_recorded`, `item_released` trigger nothing.
  - `recipients.test.ts` (no ID): `personBehind` for each identity form; `deciders` keeps an org admin, keeps an area admin for a `standard` item, drops an area admin for an item with domain `acl` (needs org admin), drops an editor and a viewer; `itemRefOf` and `topicFor` including the 60-character cut.
  - `sim/kernel/wakes.test.ts`:
    - `NT-2 a gate wake reaches only people who can decide it, with a deep link and no content`: park an item at Ship (use the sim ship fixtures, `sim/ship-fixtures.ts`), with an org admin, an area admin, an area editor and a viewer seeded; the delivered wake's recipients are exactly the two admins; `link === gateLink(harness.id, item.itemId)`; `Object.keys(wake)` equals the `Wake` key list (no title, body or evidence). Then the same with `riskDomains: ['acl']` on the item: only the org admin.
    - `NT-4 a final run failure wakes the item's holder at the run-failed rank and a retried step sends nothing`: a hosted run under a delegation (step 7's sim run helpers in `sim/runs.ts`) whose step is retried (no `run_failed`) delivers nothing; then `kernel.runs.fail` (step 7's name; grep `fail(` in `packages/harness/runs/commands.ts`) delivers one `run_failed` wake to the delegation's person with `itemLink`.
    - `NT-4 a lapsed delegation wakes its person at the top rank, or the area's other admins when that person lost the grant`: revoke the delegation → recipient is its person, reason `delegation_lapsed`, link `/`; a second delegation whose person's admin grant is revoked (lapse `grant_lost`) → recipients are every other area admin, not the person.
    - `NT-4 a lapsed delegation and a failed run appear on Home and on the play-by-play`: after both, step 8's WB-9 read (find it with `grep -rn "WB-9" packages/harness sim`) lists the lapsed delegation for its person and the failed run for the holder; the item's event read (`kernel.events` with the item filter) shows `run_failed` and the `run_stopped` with `why: 'delegation_lapsed'` where the lapse stopped a run.
    - `NT-1 a stage advance wakes only the item's holder`: an agent `agent:<person>/<device>` submits at a `checks` exit that advances → one `stage_advanced` wake to that person; a person who submits their own item and advances it gets none (Review Focus 5); a person submitting to a gate they could decide is not among that gate wake's recipients.
    - `a notifier or hub failure after commit leaves the command accepted` (no ID): a notifier whose `notify` throws and a hub whose `present` throws; the submit still answers `accepted` and its events are recorded.
  - `sim/scenarios/NT-1.a-gate-wake-is-ranked-cooled-and-suppressed.ts`: two admins subscribed (`notifier.subscribe`); park item A → both `sent`; park item B one minute later → both `coalesced`; admin 2 enters the `gates` screen (`hub.enter`), park item C eleven minutes after A → admin 1 `sent`, admin 2 `suppressed`; a `stage_advanced` for admin 1's held item at minute 12 → `coalesced` (weaker than the open rank-3 window); a run failure on admin 1's item at minute 23 → `sent`. Return the decision list as state.
  - `sim/scenarios/NT-2.a-gate-wake-reaches-only-who-can-decide.ts`: the recipients clause from the test above, as a scenario.
  - `sim/scenarios/NT-4.a-lapse-and-a-final-failure-wake-their-people.ts`: the lapse and the run failure, with the decisions.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run packages/harness/notify sim/kernel/wakes.test.ts && pnpm sim -- NT-1`. Expected: FAIL.

- [ ] **Step 3: Implement** the files in **Files** to the rules above. Keep `plan.ts` under 500 lines by putting the per-reason recipient functions in `recipients.ts`. `notifyCommitted` and `planWakes` take ports, never a logger.

- [ ] **Step 4: Run the tests and scenarios.** Run: `pnpm vitest run packages/harness sim/kernel && pnpm sim -- all`. Expected: PASS, and every earlier scenario still passes (the sim notifier has no devices and Zulip off, so no earlier event log changes).

- [ ] **Step 5: Commit.**

```bash
git add packages/harness sim
git commit -m "feat(harness): after commit the kernel names each wake's people, reason, link and topic, reads presence from the hub, and hands it to the notifier

A gate wake goes only to people who could decide it; a lapse wakes its person or
the area's other admins; a final run failure wakes the holder; a stage advance
wakes the holder only. A failure after commit never changes the command's outcome.

NT-1 NT-2 NT-4"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 4: The Zulip topic on the item, and replies as comments in the kernel

**Requirements proven:** NT-3 (one topic per item, created on first wake, stored on the item; replies recorded as comments with the author mapped or null; the bot accepts no commands). Closes the step-3 carry (`notReplayed`).

**Files:**
- Modify: `packages/harness/items/fold.ts` (fold `zulip_topic_linked`; delete `notReplayed`), `packages/harness/items/repair.ts`, `sim/runner/log.ts`, `packages/harness/index.ts` (drop the `notReplayed` export), `sim/runner/log.test.ts`, `sim/kernel/repair.test.ts` (their `zulipTopic` drift cases now expect the drift to be reported and repaired like any other field)
- Modify: `packages/harness/notify/topic.ts` (`linkTopic`), `packages/harness/notify/after-commit.ts` (link after `posted`)
- Create: `packages/harness/items/comments.ts`; Modify: `packages/harness/items/commands.ts` (`recordComment`), `packages/harness/reads/index.ts` (`zulipTarget`), and a new `packages/harness/reads/zulip-target.ts`
- Create tests: `packages/harness/items/fold-topic.test.ts`, `sim/kernel/comments.test.ts`
- Create scenario: `sim/scenarios/NT-3.a-reply-saying-approve-is-a-comment.ts`

**Interfaces:**
- Consumes: Task 1's evidence schemas, `ZULIP_TEXT_LIMIT`; Task 3's `notifyCommitted`, `topicFor`.
- Produces:

```ts
export function linkTopic(
  ports: Pick<Ports, 'store' | 'ids'>,
  input: { readonly itemId: string; readonly topic: string; readonly at: Date; readonly traceId: string },
): Promise<void>;

export type CommentInput = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly messageId: number;
  readonly topic: string;
  readonly personId: string | null;
  readonly email: string;
  readonly text: string;
};
ItemCommands['recordComment']: (caller: Caller, input: CommentInput) => Promise<KernelOutcome<{ readonly eventId: string }>>;

export type ZulipTarget = { readonly harnessId: string; readonly jdArea: JdArea; readonly itemId: string | null };
KernelReads['zulipTarget']: (caller: Caller, input: { readonly topic: string }) => Promise<KernelOutcome<ZulipTarget>>;
```

- Rules (exact):
  - Fold: `zulip_topic_linked` sets `zulipTopic` to the evidence's `topic`. `notReplayed` is deleted after `grep -rn notReplayed` shows only the uses listed in **Files**; repair and the sim drift check compare every field.
  - `linkTopic`: one transaction; `tx.harnessItems.read.lock(itemId)`; if the item is missing or its `zulipTopic` is not null, write nothing; else record `zulip_topic_linked` `{ topic }` through `recordItemEvents` with actor `agent:system` (`systemIdentity`), the wake's trace id and `requestId: null`.
  - `notifyCommitted` (Task 3) calls `linkTopic` after a delivery whose `zulip === 'posted'` for an item wake whose item's stored topic was null when planned. A throw is caught.
  - `recordComment`: refused `not_permitted` unless `isIngestPrincipal(caller.actor)`; `harness_not_found` when the harness is missing; `item_not_found` when `itemId` is given and the item is missing or on another harness; `text` cut to `ZULIP_TEXT_LIMIT` characters with `truncated` set; appends one `comment_recorded` (item-level when `itemId` is given, harness-level otherwise) with actor `agent:ingest`; changes no item column, writes no `gate_decisions`, touches no stage.
  - `zulipTarget`: ingest principal only (`not_permitted` otherwise). Split the topic at the first `/`: the harness by key (`harness_not_found` if none); no `/` → `{ harnessId, jdArea, itemId: null }`; else the items of that harness (`harnessItems.read.forHarness`) whose `zulipTopic` equals the whole topic: exactly one → its id; none or more than one → `item_not_found` (detail `why: 'ambiguous_topic'` for more than one).

- [ ] **Step 1: Write the failing tests and scenario.**
  - `fold-topic.test.ts` (no ID): folding `zulip_topic_linked` sets the topic; replay of a log with it equals the projected row in every field, `zulipTopic` included.
  - `sim/kernel/comments.test.ts`:
    - `NT-3 one topic per item is created on the first wake, stored on the item and kept`: Zulip enabled on the sim notifier; park item A → one post to `software/item-<8 hex>` and the item's `zulipTopic` is that topic, with one `zulip_topic_linked` event; reject and re-park → a second post to the same topic and still one `zulip_topic_linked`; an item wrapping issue `unfoldingWord/uw-platform#42` posts to `software/uw-platform#42`; a `stage_advanced` posts nothing; a harness-level lapse posts to `software`.
    - `NT-3 a Zulip outage drops the wake and nothing else fails`: arm `failNext`, park → zulip `dropped`, no `zulip_topic_linked`, the submit `accepted`, push decisions present.
    - `NT-3 a reply is a comment with its author mapped by email, or none`: `recordComment` as the ingest principal with a person id → one `comment_recorded` with that `personId`; with `personId: null` and the email kept; a 12 000-character text → 10 000 characters and `truncated: true`; as a person principal → `not_permitted` and nothing recorded.
    - `NT-3 a reply saying approve is a comment and decides nothing`: an item parked at Ship; `recordComment` with text `approve` → the item is still `parked`, `gateDecisions.read.forItem` is empty, the only new event is `comment_recorded`.
    - `zulipTarget finds the item by its stored topic, the harness by a bare key, and nothing for an unknown or shared topic` (no ID).
  - `sim/scenarios/NT-3.a-reply-saying-approve-is-a-comment.ts`: Zulip on; park at Ship → topic linked; a reply `approve` from a mapped person and one from an unmapped email → two comments; no gate decision; the item still parked.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run packages/harness/items sim/kernel/comments.test.ts && pnpm sim -- NT-3`. Expected: FAIL.

- [ ] **Step 3: Implement** to the rules above.

- [ ] **Step 4: Run.** Run: `pnpm vitest run packages/harness sim && pnpm sim -- all`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/harness sim
git commit -m "feat(harness): the Zulip topic is linked on the item by an event, and replies are comments the ingest principal records

zulip_topic_linked joins the fold, so notReplayed is gone and replay equals the
row in every field. A reply decides nothing.

NT-3"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 5: Presence on the live hub

**Requirements proven:** NT-1's "suppresses the wake when the person has a live session on that screen" on the platform (P24). Closes the step-6 carry with Task 3.

**Files:**
- Modify: `apps/uw-app/live/hub-core.ts` (tag gains `screen`, `itemId`; `GET /presence`), `apps/uw-app/live/hub-core.test.ts`, `apps/uw-app/live/connect.ts` (query `screen` and `item`, headers `x-hub-screen`, `x-hub-item`), `apps/uw-app/live/connect.pg.test.ts`, `apps/uw-app/live/testing.ts`
- Modify: `apps/uw-app/ports/hub.ts` (`present`), `apps/uw-app/ports/hub.test.ts`, `apps/uw-app/ports/hub.contract.test.ts`
- Modify: `apps/uw-app/islands/live/session.ts` and the step-8 views that open a live session (find them with `grep -rn "connect:" apps/uw-app/islands apps/uw-app/views 2>/dev/null; grep -rn "/live" apps/uw-app/islands`): each passes its screen (`home`, `flow`, `board`, `gates`, `item`) and, on the item view, the item id
- Modify: `docs/exceptions.md` only if the existing `connect.ts` row needs the new query named (edit that row's text; same commit)

**Interfaces:**
- Consumes: `liveScreenSchema`, `PresenceQuery`.
- Produces: the hub's internal route `GET https://hub.internal/presence?person=<uuid>&screen=<live-screen>&item=<uuid>` answering `200 {"present":true|false}`, `400` on a malformed query; `platformHub(...).present(query)`; `LiveSessionOptions` gains `readonly screen: LiveScreen; readonly itemId: string | null`.
- Socket tag:

```ts
const tagSchema = z.strictObject({
  openedAt: z.number().int().nonnegative(),
  person: z.uuid(),
  screen: liveScreenSchema.nullable().default(null),
  itemId: z.uuid().nullable().default(null),
});
```

- Rules: `present` is true when an open socket's tag has the same `person` and `screen` and, when `screen === 'item'`, the same `itemId`. `connect` reads `screen` (optional; absent → null) and `item` (optional; only with `screen=item`, else `malformed_command`); an unknown screen → `malformed_command`. The platform adapter's `present` is bounded at 2 s (the existing `WAKE_TIMEOUT_MS` pattern); a timeout, a non-200 answer or a body that fails `z.strictObject({ present: z.boolean() })` answers `false` and logs `hub_presence_unknown` with the harness id.

- [ ] **Step 1: Write the failing tests.**
  - `hub-core.test.ts`: `NT-1 a person is present on the screen and item their session connected for`; `a socket accepted before this change, with no screen in its attachment, stays open and is never presence` (Review Focus 1: serialize `{ openedAt, person }` only, run `shed`, assert the socket is not closed and `present` is false); `presence ignores closed sockets`; `GET /presence with a malformed person or screen answers 400`.
  - `connect.pg.test.ts`: the forwarded request carries `x-hub-screen` and `x-hub-item`; `screen=nowhere` and `item=<uuid>` without `screen=item` answer `malformed_command`.
  - `ports/hub.test.ts`: `present` answers the hub's boolean; a timeout, a 500 and a malformed body answer `false` and log `hub_presence_unknown`.
  - The platform Hub contract (`hub.contract.test.ts`) gains the subject's `enter`, implemented by connecting a fake socket through `apps/uw-app/live/testing.ts`.

- [ ] **Step 2: Run and see them fail.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/live apps/uw-app/ports/hub`. Expected: FAIL.

- [ ] **Step 3: Implement** to the rules above; the islands pass their screen.

- [ ] **Step 4: Run.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/uw-app docs/exceptions.md
git commit -m "feat(uw-app): the live hub knows which screen and item each session watches and answers presence

A socket opened before this change keeps its session and is simply never presence.

NT-1"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 6: The platform notifier's web push: subscriptions, the cooldown claim, the send, the prune

**Requirements proven:** NT-1 (subscribe and unsubscribe from the installed app; expired subscriptions pruned; one cooldown window per person claimed atomically; suppression; every subscribed device), NT-2 (the payload sent is the strict three-field payload; every send, coalesce and suppress decision is logged with the trace id).

**Files:**
- Create: `apps/uw-app/notify/push/owns.ts`, `apps/uw-app/notify/push/store.ts`, `apps/uw-app/notify/push/transport.ts`, `apps/uw-app/notify/push/send.ts`, `apps/uw-app/notify/config.ts`, `apps/uw-app/notify/notifier.ts` (push half; Task 7 adds Zulip), `apps/uw-app/notify/routes.ts`
- Create: `apps/uw-app/ports/notifier.ts` (`platformNotifier`, `notifierOf`), `apps/uw-app/ports/notifier.contract.pg.test.ts`
- Create tests: `apps/uw-app/notify/push/store.pg.test.ts`, `apps/uw-app/notify/push/cooldown-race.pg.test.ts`, `apps/uw-app/notify/push/transport.test.ts`, `apps/uw-app/notify/push/send.pg.test.ts`, `apps/uw-app/notify/routes.pg.test.ts`, `apps/uw-app/notify/testing.ts` (fixture VAPID and subscription keys made with Web Crypto, a recording fake `fetch`)
- Modify: `apps/uw-app/env.ts` (`APP_ORIGIN?`, `VAPID_PUBLIC_KEY?`, `VAPID_SUBJECT?`, `VAPID_PRIVATE_JWK?`), `apps/uw-app/app.tsx` (`app.route('/api/push', pushRoutes())` after `withPrincipal`), `apps/uw-app/package.json` (`@pushforge/builder` `2.0.5`, exact), `pnpm-lock.yaml`, `docs/exceptions.md` (two rows, same commit, written first), `tools/architecture/command-routes.test.ts` or whichever static route test names exempt routes (add `/api/push/*` beside `/api/me`), `.dependency-cruiser.mjs` (rule `pushforge-only-in-push-transport`: `@pushforge/builder` imported only by `apps/uw-app/notify/push/transport.ts`)

**Interfaces:**
- Consumes: Task 1's push schemas and tables; Task 2's `Notifier`, `Wake`, `WakeDelivery`, `chooseInWindow`, `wakeRank`, `COOLDOWN_MS`.
- Produces:

```ts
export type PushConfig = {
  readonly publicKey: string;
  readonly subject: string;
  readonly privateJwk: JsonWebKey;
};
export type NotifyConfig = {
  readonly appOrigin: string | null;
  readonly push: PushConfig | null;
  readonly zulip: ZulipConfig | null;
};
export function notifyConfigOf(env: Bindings): NotifyConfig;

export type PushDevice = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };
export type PushStore = {
  subscribe(personId: string, input: PushSubscribe, at: Date): Promise<void>;
  unsubscribe(personId: string, endpoint: string): Promise<boolean>;
  devicesOf(personId: string, at: Date): Promise<readonly PushDevice[]>;
  prune(endpoint: string): Promise<void>;
  claimWindow(personId: string, rank: number, at: Date): Promise<boolean>;
};
export function pushStore(db: Executor): PushStore;

export type PushTransport = {
  send(device: PushDevice, payload: PushPayload, rank: number): Promise<number | 'failed'>;
};
export function webPushTransport(config: PushConfig, fetcher: typeof fetch, timers: Timers): PushTransport;

export type NotifierDeps = {
  readonly db: Executor;
  readonly config: NotifyConfig;
  readonly push: PushTransport | null;
  readonly zulip: ZulipPoster | null;
  readonly sink: LogSink;
  readonly commit: string;
};
export function platformNotifier(deps: NotifierDeps): Notifier;
export function notifierOf(env: Bindings, database: DatabaseHandle | null, sink: LogSink): Notifier;
export function pushRoutes(): Hono<AppEnv>;
```

(`ZulipConfig` and `ZulipPoster` are declared in Task 7; in this task `zulip` is always `null` and the delivery's `zulip` is `not_configured`.)

- Rules (exact):
  - `notifyConfigOf`: `push` is non-null only when `VAPID_PUBLIC_KEY` matches `/^[A-Za-z0-9_-]{87}$/`, `VAPID_SUBJECT` starts with `mailto:` or `https://`, and `VAPID_PRIVATE_JWK` parses as JSON with `kty: 'EC'`, `crv: 'P-256'` and string `d`, `x`, `y`; `appOrigin` is `APP_ORIGIN` when it parses as an `https:` origin with no path, else null. Never throws.
  - `pushStore.subscribe`: upsert on `endpoint` (a re-subscribe by another person moves the row to the caller), `expires_at` from `expirationTime` (milliseconds) or null; then, if the person holds more than 20 rows, delete their oldest by `created_at` until 20 remain.
  - `pushStore.devicesOf`: deletes the person's rows whose `expires_at <= at` (pruned, logged by the caller with the count) and answers the rest ordered by `created_at`.
  - `pushStore.claimWindow` is one statement:

```sql
INSERT INTO push_cooldowns (person_id, window_started_at, rank)
VALUES ($1, $2, $3)
ON CONFLICT (person_id) DO UPDATE
  SET window_started_at = EXCLUDED.window_started_at, rank = EXCLUDED.rank
  WHERE push_cooldowns.window_started_at <= EXCLUDED.window_started_at - interval '600 seconds'
     OR push_cooldowns.rank < EXCLUDED.rank
RETURNING person_id
```

  answering whether a row came back. It must agree with `chooseInWindow` (the contract suite proves both adapters give the same decisions).
  - `webPushTransport.send`: `buildPushHTTPRequest({ privateJWK, subscription: { endpoint, keys: { p256dh, auth } }, message: { payload, adminContact: subject, options: { ttl: 3600, urgency: rank === 3 ? 'high' : 'normal' } } })` (check the 2.0.5 type names in `node_modules/@pushforge/builder/dist/lib/main.d.ts` and use them exactly), then `fetch(endpoint, { method: 'POST', headers, body })` bounded at 5 s; answers the status, or `'failed'` on a throw or timeout. The payload passed is `pushPayloadSchema.parse(...)` of `{ harness, reason, link }` and nothing else.
  - Per recipient (`send.ts`), in this order, logging one line each with a logger whose context `traceId` is the wake's trace id and `route` is `notifier`: `present` → `push_suppressed`; config null → `push_not_configured`; no devices → `push_no_device`; `claimWindow` false → `push_coalesced`; else send to every device in parallel: 404 or 410 → `prune` and log `push_pruned`; any 2xx counts as delivered; the decision is `sent` if at least one device answered 2xx (log `push_sent` with `device_count` and `delivered_count`), else `dropped` (log `push_dropped`). Log fields are ids, the reason and counts only: `person_id`, `harness_id`, `item_id`, `reason`, never an endpoint or key.
  - `pushRoutes`: `GET /key` → `{ status: 'accepted', publicKey }` or `{ status: 'error', reason: 'not_wired' }` when push is not configured; `POST /subscriptions` (body `pushSubscribeSchema`) and `POST /subscriptions/remove` (body `pushUnsubscribeSchema`) → `{ status: 'accepted' }`. Refusals: no database `database_not_configured`; no principal `unauthenticated`; an agent principal or `personId === null` `not_permitted`; a body that fails its schema `malformed_command`. Only the caller's own rows are touched.
  - `docs/exceptions.md` rows (2026-10-03 or the commit date): section 10 "no route without `can()`" for `apps/uw-app/notify/routes.ts` (`/api/push/*`: a person's own push subscriptions, no harness or area to scope; refuses agents); rule 2 "application code reaches Postgres only through a port" for `apps/uw-app/notify/push/store.ts` (a platform module, the notifier, owns `push_subscriptions` and `push_cooldowns` and writes them with Drizzle directly, as `tasks/store.ts` does).

- [ ] **Step 1: Write the failing tests.**
  - `transport.test.ts`: `NT-2 the push request carries only the harness, the reason and the link, encrypted`: with fixture keys, the fake `fetch` receives a POST to the endpoint with `Content-Encoding: aes128gcm`, an `Authorization` header starting `vapid t=`, `TTL: 3600`, `Urgency: high` for rank 3; the payload the transport passed to `buildPushHTTPRequest` (capture with `vi.spyOn` on the module's import, or by building through a seam `buildRequest` parameter) deep-equals `{ harness, reason, link }`; the body bytes do not contain the harness key in plain text. A timeout answers `'failed'`.
  - `store.pg.test.ts`: subscribe, re-subscribe moves the endpoint, the 21st subscription removes the oldest, `devicesOf` deletes expired rows, `unsubscribe` removes only the caller's row.
  - `cooldown-race.pg.test.ts`: `two wakes for one person on two connections claim the window once` (Review Focus 3): two `claimWindow(person, 3, at)` on separate connections released together → exactly one `true`.
  - `send.pg.test.ts`: `NT-1 every subscribed device is sent the wake and an expired or gone device is pruned`: two devices both 201 → `sent`, `delivered_count` 2; one device 410 → pruned and still `sent` from the other; all failing → `dropped` and the window spent (a second wake inside ten minutes is `coalesced`); `NT-2 every send, coalesce and suppress decision is logged with the trace id`: the recorded sink lines carry the wake's trace id and the outcomes `push_sent`, `push_coalesced`, `push_suppressed`, and no line holds an endpoint or key.
  - `routes.pg.test.ts`: `NT-1 a person subscribes and unsubscribes a device from the installed app`; an agent principal and a service token are `not_permitted`; an endpoint off the allow-list is `malformed_command` (Review Focus 2); `GET /key` answers `not_wired` with no VAPID configuration.
  - `ports/notifier.contract.pg.test.ts`: `describeNotifierContract('the platform notifier on Postgres', …)` with fixture keys, a fake `fetch` that answers 201, people seeded through `packages/db/test-seed.ts`, `subscribe` through `pushStore`, and Zulip not configured (the Zulip cases of the contract that need posting are skipped with `it.skipIf` until Task 7 by a subject flag `zulip: false`; Task 7 turns it on).

- [ ] **Step 2: Run and see them fail.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/notify apps/uw-app/ports/notifier.contract.pg.test.ts`. Expected: FAIL.

- [ ] **Step 3: Install and implement.** `pnpm add --filter @uw/uw-app @pushforge/builder@2.0.5 --save-exact`. Implement to the rules; write the two `docs/exceptions.md` rows first.

- [ ] **Step 4: Run.** Same command, then `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/uw-app package.json pnpm-lock.yaml docs/exceptions.md tools .dependency-cruiser.mjs
git commit -m "feat(uw-app): web push from the notifier: subscriptions, one cooldown window per person claimed in Postgres, every device, pruning, and a log line per decision

NT-1 NT-2"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 7: The platform notifier's Zulip post, and the topic link on the play-by-play

**Requirements proven:** NT-3 (a wake posts the harness, item ref, reason and link and never the body, diff or findings; the topic is in the channel mapped to the harness's area; a Zulip outage drops the wake and logs it; linked from the play-by-play), NT-4 (a harness-level lapse posts to the harness's topic).

**Files:**
- Create: `apps/uw-app/notify/zulip/config.ts`, `apps/uw-app/notify/zulip/message.ts`, `apps/uw-app/notify/zulip/post.ts`, `apps/uw-app/notify/zulip/links.ts`
- Create tests: `apps/uw-app/notify/zulip/message.test.ts`, `apps/uw-app/notify/zulip/post.test.ts`, `apps/uw-app/notify/zulip/links.test.ts`
- Modify: `apps/uw-app/notify/config.ts`, `apps/uw-app/notify/notifier.ts`, `apps/uw-app/ports/notifier.ts`, `apps/uw-app/ports/notifier.contract.pg.test.ts` (Zulip cases on, with a fake `fetch`), `apps/uw-app/env.ts` (`ZULIP_SITE?`, `ZULIP_BOT_EMAIL?`, `ZULIP_BOT_API_KEY?`, `ZULIP_CHANNELS?`)
- Modify: the step-8 item play-by-play view's Zulip slot (find it with `grep -rni "zulip" apps/uw-app packages/ui`), and its test

**Interfaces:**
- Produces:

```ts
export type ZulipConfig = {
  readonly site: string;
  readonly botEmail: string;
  readonly apiKey: string;
  readonly channels: ReadonlyMap<JdArea, string>;
};
export function zulipConfigOf(env: Bindings): ZulipConfig | null;

export function zulipContent(wake: Wake, appOrigin: string): string;
export const reasonSentence: Readonly<Record<'gate_waiting' | 'delegation_lapsed' | 'run_failed', string>>;

export type ZulipPoster = {
  post(channel: string, topic: string, content: string): Promise<'posted' | 'dropped'>;
};
export function zulipPoster(config: ZulipConfig, fetcher: typeof fetch, timers: Timers): ZulipPoster;

export function zulipTopicUrl(site: string, channel: string, topic: string): string;
export function itemTopicUrl(config: ZulipConfig | null, jdArea: JdArea, topic: string | null): string | null;
```

- Rules (exact):
  - `zulipConfigOf`: non-null only when `ZULIP_SITE` is an `https:` origin with no path, `ZULIP_BOT_EMAIL` is an email, `ZULIP_BOT_API_KEY` is 1 to 200 characters, and `ZULIP_CHANNELS` parses as a JSON object whose keys pass `jdAreaSchema` and whose values are 1 to 60 characters. Never throws.
  - `reasonSentence`: `gate_waiting` → `A gate is waiting on a person`, `delegation_lapsed` → `A delegation lapsed`, `run_failed` → `A run failed`.
  - `zulipContent(wake, origin)`: `` `${wake.harnessKey} · ${wake.itemRef}: ${sentence}. ${origin}${wake.link}` `` for item wakes and `` `${wake.harnessKey}: ${sentence}. ${origin}${wake.link}` `` for harness-level ones. Nothing else; no `@`.
  - Notifier Zulip half, after the push half and independent of the cooldown (P25): reason not in `POSTING_REASONS` → `not_posted` (no log line); Zulip config or `appOrigin` null → `not_configured` (log `zulip_not_configured`); no channel for `wake.jdArea` → `dropped` (log `zulip_channel_unmapped`); else `post(channel, wake.topic, zulipContent(...))` → `posted` (log `zulip_posted`) or `dropped` (log `zulip_dropped`). The push and Zulip halves run in parallel; one failing never changes the other's decision.
  - `zulipPoster.post`: `POST ${site}/api/v1/messages`, header `authorization: Basic base64(botEmail:apiKey)`, `content-type: application/x-www-form-urlencoded`, body `type=stream&to=<channel>&topic=<topic>&content=<content>` (`URLSearchParams`), bounded at 5 s; `posted` only for a 200 whose JSON has `result: 'success'`; every other answer, a throw or a timeout is `dropped`.
  - `zulipTopicUrl(site, channel, topic)`: `` `${site}/#narrow/channel/${hash(channel)}/topic/${hash(topic)}` `` where `hash(s) = encodeURIComponent(s).replace(/\./g, '%2E').replace(/%/g, '.')` (Zulip's hash encoding). `itemTopicUrl` answers null when config, channel or topic is missing. The play-by-play's Zulip slot renders a link with the accessible name `Open the Zulip topic` when it is non-null, and the text `No Zulip topic yet` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `message.test.ts`: `NT-3 a Zulip post names the harness, the item ref, the reason and the link and nothing else`: for a wake built from an item whose title is `Secret plan` and whose findings exist, the content equals the exact string above and contains neither the title nor `@`; a harness-level lapse; `stage_advanced` never reaches `zulipContent` (the notifier answers `not_posted`).
  - `post.test.ts`: the fake `fetch` sees the URL, the basic auth header and the form body; a 400, a 200 with `result: 'error'`, a throw and a timeout each answer `dropped`.
  - `links.test.ts`: a topic `software/uw-platform#42` in channel `80-89 Technology` becomes `https://chat.example/#narrow/channel/80-89.20Technology/topic/software.2Fuw-platform.2342`.
  - Contract (`notifier.contract.pg.test.ts`): Zulip cases on; plus `NT-3 a Zulip outage drops the wake, logs it, and push still sends` (fake `fetch` throwing for the Zulip host and answering 201 for the push endpoint; delivery `{ zulip: 'dropped' }` with push `sent`; the sink holds `zulip_dropped` with the trace id) and `NT-3 the post goes to the channel mapped to the harness's area` (two areas in `ZULIP_CHANNELS`; the form body's `to` is the wake's area's channel; an unmapped area answers `dropped` and logs `zulip_channel_unmapped`).
  - The play-by-play view test: the slot renders the topic link for an item with `zulipTopic` and the placeholder text otherwise, in light and dark at 390 px with the view's existing render helpers.

- [ ] **Step 2: Run and see them fail.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/notify apps/uw-app/ports/notifier.contract.pg.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** to the rules.

- [ ] **Step 4: Run.** Same command plus the view test. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/uw-app
git commit -m "feat(uw-app): the notifier posts each waiting-on-you and run-failed wake to the item's Zulip topic in the area's channel, and the play-by-play links the topic

A Zulip outage drops the post and logs it; push is unaffected.

NT-3 NT-4"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 8: Zulip replies come in through `uw-ingest` and become comments

**Requirements proven:** NT-3 (inbound webhooks verified in `uw-ingest`; replies recorded on the item as comments with the author mapped by email; the bot accepts no commands).

**Files:**
- Create: `apps/uw-ingest/sources/zulip.ts`, `apps/uw-ingest/sources/zulip.test.ts`, `apps/uw-ingest/fixtures/zulip/outgoing-mention.json`, `apps/uw-ingest/fixtures/zulip/outgoing-private.json`
- Modify: `apps/uw-ingest/sources/registry.ts`, `apps/uw-ingest/env.ts` (`ZULIP_WEBHOOK_TOKEN?`; `WebhookSource` gains optional `redact?(payload: unknown): unknown`), `apps/uw-ingest/receive.ts` (apply `redact` to the parsed payload before the envelope), `apps/uw-ingest/app.test.ts`
- Create: `apps/uw-app/notify/zulip/inbound.ts`, `apps/uw-app/notify/zulip/inbound.pg.test.ts`
- Modify: `apps/uw-app/people/directory.ts` (`personByEmail(db, email): Promise<PersonRecord | null>`, active people only, email compared lower-cased and trimmed the way `signIn` normalises it), `apps/uw-app/people/directory.pg.test.ts`, `apps/uw-app/queue/consumer.ts` (`notWiredHandlers` gains `zulip`), `apps/uw-app/queue/worker.ts` (`zulip` handler), `apps/uw-app/queue/consumer.test.ts`

**Interfaces:**
- Consumes: `zulipOutgoingSchema`, `zulipMessageSchema`, `ZulipConfig`, Task 4's `kernel.reads.zulipTarget` and `kernel.items.recordComment`.
- Produces: `zulipSource: WebhookSource`; `zulipIngestHandler(deps: { db: Executor; kernel: Kernel; config: ZulipConfig | null; now: () => Date }): IngestHandler`.
- Rules (exact):
  - `zulipSource.secret(env)` → `env.ZULIP_WEBHOOK_TOKEN`. `verify(headers, rawBody, secret)`: parse JSON (failure `malformed_delivery`); no string `token` → `unsigned`; `sameSecret(token, secret)` false → `bad_signature`, where `sameSecret` digests both with SHA-256 (`crypto.subtle.digest`) and compares the 32 bytes with an XOR accumulator over every byte; then `zulipOutgoingSchema` must parse (`malformed_delivery` otherwise); answers `{ deliveryId: \`zulip:${message.id}\`, event: 'message' }`. `redact(payload)` returns the payload object without `token`.
  - The response to an accepted delivery stays `{ "status": "accepted" }`: it has no `content`, so Zulip posts no reply.
  - `zulipIngestHandler`: payload `null` or truncated → log `payload_truncated`, `handled`; `zulipMessageSchema` fails → `malformed`; `message.type === 'private'` → log `zulip_private_ignored`, `handled`; `kernel.reads.zulipTarget(ingestCaller, { topic: message.subject })` refused → log `zulip_topic_unknown`, `handled`; `config` null or `config.channels.get(target.jdArea) !== message.display_recipient` → log `zulip_channel_mismatch`, `handled`; else `personByEmail` → `kernel.items.recordComment(ingestCaller, { harnessId, itemId, messageId: message.id, topic: message.subject, personId: person?.id ?? null, email: message.sender_email, text: message.content })` → log `comment_recorded` with the message id and harness id (never the text) and `handled`; a refused record → log its reason, `handled`. `ingestCaller` is `{ actor: ingestPrincipal(), traceId: envelope.traceId, requestId: null }`.
  - The worker builds the kernel for the `zulip` handler with the same `hubWiring(unit.hub)` the GitHub handler uses (Task 9 adds the notifier there).

- [ ] **Step 1: Write the failing tests.**
  - `apps/uw-ingest/sources/zulip.test.ts` and `app.test.ts`: `NT-3 an inbound Zulip webhook is accepted only with the bot's token and enqueued without it`: the right token → accepted, the enqueued envelope's payload has no `token`, delivery id `zulip:<id>`; a wrong token → 401 `bad_signature`; no token → 401 `unsigned`; no `ZULIP_WEBHOOK_TOKEN` → 503 `source_not_configured`; a replay of the same message id → 409 `replayed`; the accepted response body has no `content` key.
  - `inbound.pg.test.ts`: `NT-3 a reply in the item's topic is recorded on the item with its author mapped by email`; `NT-3 a reply from an unmapped author is recorded with the email and no person`; `NT-3 a reply saying approve on a parked item is a comment and no gate decision exists` (Review Focus 4: `SELECT count(*) FROM gate_decisions` unchanged, the item still `parked`); `a private message, a topic in another area's channel and an unknown topic record nothing` (Review Focus 4); a reply in the harness's own topic is a harness-level comment.
  - `directory.pg.test.ts`: `personByEmail` finds an active person case-insensitively and not a pending one.

- [ ] **Step 2: Run and see them fail.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-ingest apps/uw-app/notify/zulip apps/uw-app/people apps/uw-app/queue`. Expected: FAIL.

- [ ] **Step 3: Implement** to the rules.

- [ ] **Step 4: Run.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/uw-ingest apps/uw-app
git commit -m "feat(uw-ingest,uw-app): Zulip replies arrive through the token-checked webhook and become comments on the item

The token is compared in constant time and stripped before the queue; a reply in a
topic outside its harness's channel, or a private message, records nothing; no reply
decides a gate.

NT-3"
```

- [ ] **Step 6: Verify.** Run the verify command. Expected: green.

---

### Task 9: Wire the notifier into every kernel that appends, the installed app's push, go-live configuration, and the record

**Requirements proven:** NT-1 (subscribe from the installed app; a push opens straight to the deep link), NT-2 (the deep links resolve to the step-8 views), and the step marked Built with its evidence.

**Files:**
- Modify: `apps/uw-app/kernel.ts` (`KernelWiring` gains `notifier: Notifier`; `hubWiring(hub: Hub, notifier: Notifier = notifierNotWired)`; `platformPorts` uses `wiring.notifier`)
- Modify every root that appends (list them with `grep -rn "hubWiring(" apps/uw-app --include=*.ts | grep -v test`): `apps/uw-app/commands/dispatch.ts`, `apps/uw-app/commands/person/gate-kernel.ts`, `apps/uw-app/mcp/routes.ts`, `apps/uw-app/queue/worker.ts`, `apps/uw-app/cron/github-sweep.ts`, and step 7's cron and run-host roots: each passes `notifierOf(c.env or env, database, sink)`
- Create test: `apps/uw-app/notify/wiring.pg.test.ts`
- Modify: the service worker step 8 wrote (find it with `grep -rln "addEventListener('fetch'" apps/uw-app packages/ui`) to handle `push` and `notificationclick`; Create: `apps/uw-app/islands/push/subscribe.ts`, `apps/uw-app/islands/push/subscribe.test.ts`; Modify: the step-8 Home view to render the control
- Modify (shared roots, own commit): `infra/uw-app/wrangler.go-live.toml` (staging and production `vars`: `APP_ORIGIN = "set-at-go-live"`, `VAPID_PUBLIC_KEY = "set-at-go-live"`, `VAPID_SUBJECT = "set-at-go-live"`, `ZULIP_SITE = "set-at-go-live"`, `ZULIP_BOT_EMAIL = "set-at-go-live"`, `ZULIP_CHANNELS = "{}"`), `infra/README.md` (the secrets `VAPID_PRIVATE_JWK`, `ZULIP_BOT_API_KEY` for `uw-app` and `ZULIP_WEBHOOK_TOKEN` for `uw-ingest`, and the Zulip outgoing-webhook URL `https://<uw-ingest host>/webhooks/zulip`)
- Modify (docs, own commit): `docs/architecture.md` (the Notifier row: platform adapter `apps/uw-app/ports/notifier.ts` over `apps/uw-app/notify/`; a "Reaching a person" section: after-commit planning, recipients, rank and cooldown, presence, push, Zulip out and in), `docs/PRD.md` (section 8.1: the columns of `push_subscriptions` and `push_cooldowns`; 8.3: `wake reason` and `live screen`; 8.6: `zulip_topic_linked` and a sentence on `comment_recorded` evidence, contract 12.0.0), `docs/progress_tracker.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `hubWiring(hub, notifier)`.
- Service worker rules: on `push`, parse `event.data.json()` with a hand check of the three keys (the worker bundle does not import Zod unless step 8's already does; if it does, use `pushPayloadSchema`); show a notification with title `unfoldingWord`, body from the reason (`gate_waiting` → `A gate is waiting on you in <harness>.`, `delegation_lapsed` → `A delegation you gave has lapsed in <harness>.`, `run_failed` → `A run on your item failed in <harness>.`, `stage_advanced` → `Your item moved to its next stage in <harness>.`), `tag` = the link (so a second wake for the same gate replaces the first), `data: { link }`; a payload that fails the check shows nothing. On `notificationclick`, close it and focus an open client on the same origin navigating it to `data.link`, or `clients.openWindow(data.link)`. The service worker still caches the shell only (P32).
- Subscribe control rules: one button, `Turn on notifications on this device` / `Turn off notifications on this device`, goes busy before the first `await`, shows the outcome in place (`Notifications are on for this device.`, `Notifications are off for this device.`, `Notifications are not set up yet.` for `not_wired`, `Your browser blocked notifications. Allow them in its settings.` for a denied permission, the closed reason otherwise). It reads `GET /api/push/key`, subscribes through `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, and posts `subscription.toJSON()` reshaped to `pushSubscribeSchema`. No Kindle (it is not a human gate action); tokens only; accessible name on the button.

- [ ] **Step 1: Write the failing tests.**
  - `wiring.pg.test.ts`: `NT-1 a parked submit through the command API wakes the deciders by web push through the platform notifier`: the command app with a fixture VAPID configuration and a fake `fetch`; an admin with one subscription; an editor submits to Ship through `POST /api/harness/:harness/commands/submit_to_gate` (or the step-6 test helpers) → the fake `fetch` received one push POST for the admin's endpoint and the sink logged `push_sent` with the request's trace id. Same through the MCP route (`submit_to_gate` by an agent identity) → `push_sent`. `NT-2 every deep link a wake carries opens a view`: for `gateLink`, `itemLink` and `homeLink` of a seeded harness and item, `GET` on the app as the admin answers 200 HTML (not 404).
  - `subscribe.test.ts`: the control goes busy before the first `await`, shows each outcome text above, and posts the reshaped subscription.
  - A service worker test beside step 8's (or `apps/uw-app/islands/push/service-worker.test.ts` exercising the exported handlers): a valid payload shows the notification with the reason's body and `data.link`; a payload with an extra `content` key shows nothing; a click opens the link.

- [ ] **Step 2: Run and see them fail.** Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/notify/wiring.pg.test.ts apps/uw-app/islands/push`. Expected: FAIL.

- [ ] **Step 3: Implement** the wiring, the service worker handlers and the control. Load the Home view in light and dark at 390 px and check the control's focus ring and outcome text.

- [ ] **Step 4: Run.** Same command. Expected: PASS.

- [ ] **Step 5: Commit the feature.**

```bash
git add apps/uw-app
git commit -m "feat(uw-app): every kernel that appends wakes people through the platform notifier; the installed app subscribes and opens a push at its deep link

NT-1 NT-2"
```

- [ ] **Step 6: Commit the go-live configuration alone.**

```bash
git add infra
git commit -m "chore(infra): the notifier's go-live variables and the secrets it reads

Shared root infra/: VAPID and Zulip settings live in wrangler.go-live.toml only;
VAPID_PRIVATE_JWK, ZULIP_BOT_API_KEY and ZULIP_WEBHOOK_TOKEN are Worker secrets set
at go-live. With any of them absent the notifier answers not_configured.

NT-1 NT-3"
```

- [ ] **Step 7: Update the record.** In `docs/progress_tracker.md`:
  - The step 9 row: state `Built`; evidence: this plan's path; scenarios `sim/scenarios/NT-1.*`, `NT-2.*`, `NT-3.*`, `NT-4.*`; the tests named NT-1 to NT-4 (`packages/contracts/notify.test.ts`, `sim/kernel/wakes.test.ts`, `sim/kernel/comments.test.ts`, `apps/uw-app/live/hub-core.test.ts`, `apps/uw-app/notify/**`, `apps/uw-app/ports/notifier.contract.pg.test.ts`, `apps/uw-ingest/sources/zulip.test.ts`); `pnpm trace:built` lists none of NT-1 to NT-4 as unproven; `pnpm verify` green with `TEST_DATABASE_URL` set; nothing has reached a real push service or Zulip.
  - A "Step 9 evidence by requirement" section in the shape of the step 6 one: NT-1, NT-2, NT-3, NT-4, each with its scenario and tests.
  - "Decisions made during the build": one row per S9-D1 to S9-D14 above (date, requirement, decision, why, cost if wrong), plus any decision an implementer recorded during the build.
  - "New dependencies": `| <date> | @pushforge/builder | Hand-written Web Push payload encryption (RFC 8291) and VAPID signing (RFC 8292) on Web Crypto (apps/uw-app/notify/push/transport.ts) |`.
  - "Not verified": a real push reaching Chrome, Firefox and Safari (an installed web app on iOS) and opening the Gates view at phone width; a real Zulip post and topic; the real shape of Zulip's outgoing-webhook payload beyond the recorded fixture; the latency an awaited wake adds to a parked submit (S9-D12).
  - "Waiting on a person", one row each: NT-1 — VAPID key pair (`npx @pushforge/builder vapid`), `VAPID_PRIVATE_JWK` as a `uw-app` secret, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` and `APP_ORIGIN` in `wrangler.go-live.toml`, then a subscribe and a gate wake on a phone — Ian; NT-3 — the Zulip bot, its email and API key (`ZULIP_BOT_API_KEY` secret), `ZULIP_SITE`, the area-to-channel map `ZULIP_CHANNELS`, the outgoing webhook to `uw-ingest` `/webhooks/zulip` and its token as `ZULIP_WEBHOOK_TOKEN` on `uw-ingest` — Jesse; NT-1 NT-3 — the switch-on PR copying the go-live variables — Ian.
  - "Carried to later steps": mark `Step 3 → Step 9` (NT-3 `notReplayed`) closed with Task 4's commit hash, and `Step 6 (WB-3) → Step 9` (presence, P24) closed with Task 3's and Task 5's commit hashes, in the style of the existing closed rows (`9 (closed)` and "Closed by step 9 Task N (`<hash>`)").
  - Any carry this build found for step 10 or 11 (for example DX-7's end-to-end scenario now including a wake and a Zulip reply).

- [ ] **Step 8: Commit the docs.** `docs/architecture.md` and `docs/PRD.md` and `docs/progress_tracker.md` are not shared roots; commit them together:

```bash
git add docs/architecture.md docs/PRD.md docs/progress_tracker.md
git commit -m "docs: step 9 built, reaching a person: the notifier, its decisions, and what waits on a person

NT-1 NT-2 NT-3 NT-4"
```

- [ ] **Step 9: Verify.** Run the verify command, then `pnpm trace:built`. Expected: both green, and `pnpm trace:built` names none of NT-1 to NT-4.
