import { sameRepository } from '@uw/harness';
import { issueByNumber } from '../../github/facts/queries.ts';
import { importStoredIssue, isImportable } from '../../github/import.ts';
import { commandHandler } from '../handler.ts';

export const importCommand = commandHandler({
  name: 'import',
  action: 'write',
  run: async (context, body) => {
    const { db } = context.database;
    if (!sameRepository(body.repository, context.harness?.repository ?? null)) {
      return { ok: false, reason: 'not_permitted' };
    }
    const change = await issueByNumber(db, body.repository, body.number);
    if (change === null) return { ok: false, reason: 'issue_not_found' };
    if (!isImportable(change)) return { ok: false, reason: 'not_permitted' };
    const deps = { db, kernel: context.kernel, client: null, now: () => context.clock.now() };
    const imported = await importStoredIssue(deps, context.caller, change, context.logger, 'sweep');
    return imported.ok ? { ok: true } : { ok: false, reason: imported.reason };
  },
});
