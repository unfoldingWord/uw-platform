import { credentialsLink, type JdArea, type PushPayload } from '@uw/contracts';
import { managesOwnArea } from '@uw/core/acl';
import type { Logger } from '@uw/core/log';
import { personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { createDrizzleGrants } from '@uw/db/store';
import { pushNotice } from '../notify/push/notice.ts';
import { pushStore } from '../notify/push/store.ts';
import type { PushTransport } from '../notify/push/transport.ts';
import { areaLabel } from '../views/parts/names.ts';
import { resourceOf } from './standing.ts';

export type RevealNotice = {
  readonly credentialId: string;
  readonly jdArea: JdArea;
  readonly revealedBy: string | null;
  readonly at: Date;
};

export type Tell = (notice: RevealNotice) => Promise<void>;

export type TellDeps = {
  readonly db: Database;
  readonly transport: PushTransport | null;
  readonly logger: Logger;
};

function revealPayload(jdArea: JdArea): PushPayload {
  return { harness: areaLabel(jdArea), reason: 'credential_revealed', link: credentialsLink };
}

async function adminsOf(db: Database, notice: RevealNotice): Promise<readonly string[]> {
  const resource = resourceOf({ id: notice.credentialId, jdArea: notice.jdArea });
  const holders = await createDrizzleGrants(db).holders(notice.jdArea, notice.at);
  return holders
    .filter((holder) =>
      managesOwnArea(personPrincipal({ ...holder, interactive: true }), resource, notice.at),
    )
    .map((holder) => holder.personId)
    .filter((personId) => personId !== notice.revealedBy);
}

export function tellAreaAdmins(deps: TellDeps): Tell {
  const send = { store: pushStore(deps.db), transport: deps.transport, logger: deps.logger };
  return async (notice) => {
    const fields = { credential_id: notice.credentialId, jd_area: notice.jdArea };
    try {
      const admins = await adminsOf(deps.db, notice);
      const payload = revealPayload(notice.jdArea);
      const decisions = await Promise.all(
        admins.map((personId) => pushNotice(send, { personId, payload, at: notice.at })),
      );
      deps.logger.info('reveal told to the area admins', {
        outcome: 'reveal_told',
        ...fields,
        admin_count: admins.length,
        sent_count: decisions.filter((decision) => decision === 'sent').length,
      });
    } catch (error) {
      deps.logger.warn('reveal not told', {
        outcome: 'reveal_not_told',
        ...fields,
        error_name: error instanceof Error ? error.name : 'non_error',
      });
    }
  };
}
