import type { Page, PageCapabilities } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';

const MIRRORED = 'issue';

export function capabilitiesOn(actor: Principal, page: Page, at: Date): PageCapabilities {
  const area = { kind: 'area', area: page.jdArea } as const;
  const mayWrite = can(actor, 'write', area, at) && page.type !== MIRRORED;
  return { canEdit: mayWrite, canRetire: mayWrite, canComment: can(actor, 'read', area, at) };
}
