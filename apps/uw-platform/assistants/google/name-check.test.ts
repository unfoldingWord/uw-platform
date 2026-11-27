import { describe, expect, it } from 'vitest';
import { assistantNameTaken } from './name-check.ts';
import type { Directory, DirectoryAnswer, DirectoryUser } from './directory.ts';

type Held = { readonly users: readonly DirectoryUser[]; readonly groups: readonly string[] };

const domain = 'unfoldingword.org';
const harnessId = '00000000-0000-4000-8000-00000000d701';

function directoryOf(held: Held, failing = false): Directory {
  const down = { ok: false, failure: 'unavailable' } as const;
  return {
    user: async (key): Promise<DirectoryAnswer<DirectoryUser | null>> =>
      failing ? down : { ok: true, value: held.users.find((user) => user.address === key) ?? null },
    group: async (key) =>
      failing ? down : { ok: true, value: held.groups.includes(key) ? { address: key } : null },
    insert: async () => down,
    setSuspended: async () => down,
    remove: async () => down,
  };
}

const user = (address: string, owner: string | null = null): DirectoryUser => ({
  id: '1',
  address,
  suspended: false,
  harnessId: owner,
});

describe('PA-14 a name is free only when no user, alias or group in Workspace holds it', () => {
  it('refuses a name a group holds, up front, and one a person holds', async () => {
    const held = { users: [user(`silas@${domain}`)], groups: [`team@${domain}`] };
    const check = (name: string) =>
      assistantNameTaken({ directory: directoryOf(held), domain }, name, null);
    expect(await check('team')).toBe(true);
    expect(await check('silas')).toBe(true);
    expect(await check('barnabas')).toBe(false);
  });

  it('lets an assistant keep the user it already owns', async () => {
    const held = { users: [user(`barnabas@${domain}`, harnessId)], groups: [] };
    const side = { directory: directoryOf(held), domain };
    expect(await assistantNameTaken(side, 'barnabas', harnessId)).toBe(false);
    expect(await assistantNameTaken(side, 'barnabas', null)).toBe(true);
  });

  it('does not refuse a name when the directory cannot answer, leaving the refusal to provisioning', async () => {
    const side = { directory: directoryOf({ users: [], groups: [] }, true), domain };
    expect(await assistantNameTaken(side, 'barnabas', null)).toBe(false);
  });
});
