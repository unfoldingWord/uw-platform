import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { JdArea, Principal } from '@uw/contracts';
import { can, type CredentialResource } from '@uw/core/acl';
import type { Executor } from '@uw/db/client';
import { credentials } from '@uw/db/schema';

const idSchema = z.uuid();

export function isId(value: string): boolean {
  return idSchema.safeParse(value).success;
}

export type Located = {
  readonly id: string;
  readonly jdArea: JdArea;
  readonly revokedAt: Date | null;
  readonly seen: boolean;
};

export function resourceOf(credential: {
  readonly id: string;
  readonly jdArea: JdArea;
}): CredentialResource {
  return {
    kind: 'credential',
    credentialId: credential.id,
    area: credential.jdArea,
    bindings: [],
    usedBy: null,
    revealGrants: [],
  };
}

export function sees(
  actor: Principal,
  credential: { readonly id: string; readonly jdArea: JdArea },
  at: Date,
): boolean {
  return can(actor, 'see', resourceOf(credential), at);
}

export async function locate(
  db: Executor,
  actor: Principal,
  credentialId: string,
  at: Date,
): Promise<Located | null> {
  if (!isId(credentialId)) return null;
  const [found] = await db
    .select({ id: credentials.id, jdArea: credentials.jdArea, revokedAt: credentials.revokedAt })
    .from(credentials)
    .where(eq(credentials.id, credentialId));
  if (found === undefined) return null;
  return { ...found, seen: sees(actor, found, at) };
}
