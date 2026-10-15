import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { command, eventsNamed, person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };
const repository = 'unfoldingWord/tc-admin-app';

async function checkOnlyHarness(db: Database, shadow: boolean): Promise<string> {
  const harnessId = randomUUID();
  const sent = await command(db, IAN, harnessId, 'activate_template', {
    requestId: randomUUID(),
    harnessKey: `tc-admin-app-${harnessId.slice(0, 8)}`,
    jdArea: '80-89',
    template: 'check-only',
    repository: `${repository}-${harnessId.slice(0, 8)}`,
    shadow,
    externalReviewerIdentities: ['uwreview[bot]'],
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  return harnessId;
}

describe.skipIf(!testServer)('GL-4 shadow through the command API', () => {
  it('activates in shadow, refuses an editor the lift, lifts for an admin and refuses setting it on', () =>
    withAppDatabase(async (db) => {
      const harnessId = await checkOnlyHarness(db, true);
      const [activated] = await eventsNamed(db, harnessId, 'template_activated');
      expect(activated?.evidence).toMatchObject({ shadow: true });
      const editor = await person(db, 'shadow-editor', 'editor', '80-89');
      const lift = { requestId: randomUUID(), shadow: false };
      expect((await command(db, editor, harnessId, 'set_shadow', lift)).body).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      const lifted = await command(db, IAN, harnessId, 'set_shadow', {
        ...lift,
        requestId: randomUUID(),
      });
      expect(lifted.body).toMatchObject({ status: 'accepted' });
      expect(await eventsNamed(db, harnessId, 'shadow_lifted')).toHaveLength(1);
      const on = await command(db, IAN, harnessId, 'set_shadow', {
        requestId: randomUUID(),
        shadow: true,
      });
      expect(on.status).toBe(400);
    }));
});
