import type { Executor } from '@uw/db/client';
import type { FreeBusyAnswer, Workspace } from '@uw/harness';
import { deleteHold, freeBusy, insertHold, listEvents } from '../assistants/google/calendar.ts';
import { orgAddresses, personMailOf } from '../assistants/google/subjects.ts';
import type { TokenDeps } from '../assistants/google/token.ts';
import { sendInviteOf, sendMailOf } from '../assistants/google/workspace-sends.ts';

export type WorkspaceDeps = {
  readonly db: Executor;
  readonly domain: string;
  readonly tokens: TokenDeps;
};

function freeBusyOf(deps: WorkspaceDeps): Workspace['freeBusy'] {
  return async ({ personId, colleagues, from, to }): Promise<FreeBusyAnswer> => {
    const addresses = colleagues.map((email) => email.trim().toLowerCase());
    const inside = await orgAddresses(deps.db, addresses, deps.domain);
    const outside = addresses.filter((email) => !inside.has(email));
    if (outside.length > 0) return { outcome: 'outside_organization', addresses: outside };
    const email = await personMailOf(deps.db, personId, deps.domain);
    if (email === null) return { outcome: 'refused' };
    return freeBusy(deps.tokens, email, addresses, { from, to });
  };
}

export function platformWorkspace(deps: WorkspaceDeps): Workspace {
  const mailOf = (personId: string) => personMailOf(deps.db, personId, deps.domain);
  return {
    listEvents: async ({ personId, from, to }) => {
      const email = await mailOf(personId);
      return email === null ? { outcome: 'refused' } : listEvents(deps.tokens, email, { from, to });
    },
    freeBusy: freeBusyOf(deps),
    placeHold: async (hold) => {
      const email = await mailOf(hold.personId);
      return email === null ? { outcome: 'refused' } : insertHold(deps.tokens, email, hold);
    },
    removeHold: async (removal) => {
      const email = await mailOf(removal.personId);
      return email === null ? { outcome: 'refused' } : deleteHold(deps.tokens, email, removal);
    },
    sendMail: sendMailOf(deps),
    sendInvite: sendInviteOf(deps),
  };
}
