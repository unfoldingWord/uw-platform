import { z } from 'zod';

const segment = '[A-Za-z0-9][A-Za-z0-9_-]*';
const human = `human:${segment}`;
const agent = `agent:${segment}`;
const device = `agent:${segment}/${segment}`;
const delegated = `agent:${segment}/${segment} as ${segment} via delegation:${segment}`;

export const humanIdentityPattern = `^${human}$`;

export const agentIdentityPattern = `^${agent}$`;

export const identityPattern = `^(?:${human}|${agent}|${device}|${delegated})$`;

export const identitySchema = z
  .string()
  .regex(new RegExp(identityPattern), 'not an identity string')
  .brand<'Identity'>();

export type Identity = z.infer<typeof identitySchema>;

export const systemIdentity = 'agent:system';

const AGENT = 'agent:';
const ASSUMING = ' as ';
const VIA_DELEGATION = ' via delegation:';

export const reservedPersonaSlugs = ['system', 'ingest'] as const;
const reserved: ReadonlySet<string> = new Set(reservedPersonaSlugs);

export const devicePattern = '^[a-z0-9][a-z0-9-]{0,31}$';
export const deviceSegmentSchema = z
  .string()
  .regex(new RegExp(devicePattern), 'a device is lowercase kebab-case, at most 32 characters');

export const personaSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'a persona slug is lowercase')
  .refine((slug) => !reserved.has(slug), 'that persona slug is reserved for the platform');

export function deviceOwnerSegment(identity: string): string | null {
  if (!identity.startsWith(AGENT)) return null;
  const slash = identity.indexOf('/');
  return slash < 0 ? null : identity.slice(AGENT.length, slash);
}

export function delegationIdOf(identity: string): string | null {
  const at = identity.lastIndexOf(VIA_DELEGATION);
  return at < 0 ? null : identity.slice(at + VIA_DELEGATION.length);
}

export function personaSlugOf(identity: string): string | null {
  if (!identity.startsWith(AGENT)) return null;
  const asAt = identity.indexOf(ASSUMING);
  const viaAt = identity.indexOf(VIA_DELEGATION);
  if (asAt >= 0 && viaAt > asAt) return identity.slice(asAt + ASSUMING.length, viaAt);
  return identity.includes('/') ? null : identity.slice(AGENT.length);
}

export function delegatedIdentity(
  device: string,
  personaSlug: string,
  delegationId: string,
): string {
  return `${device}${ASSUMING}${personaSlug}${VIA_DELEGATION}${delegationId}`;
}

export function isPersonaIdentity(value: string): boolean {
  return (
    value.startsWith(AGENT) &&
    !value.includes('/') &&
    !value.includes(' ') &&
    !reserved.has(value.slice(AGENT.length))
  );
}
