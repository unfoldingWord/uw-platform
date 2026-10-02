import { eq } from 'drizzle-orm';
import type { Role, Scope } from '@uw/contracts';
import type { AnyExecutor } from './any-database.ts';
import { grantAudit, people, roleGrants } from './schema.ts';

export type SeedPerson = {
  readonly id: string;
  readonly email: string;
  readonly status?: 'active' | 'pending';
};

export type SeedGrant = {
  readonly id: string;
  readonly personId: string;
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: string | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export async function seedPerson(db: AnyExecutor, person: SeedPerson): Promise<void> {
  await db.insert(people).values({
    id: person.id,
    email: person.email,
    displayName: person.email,
    status: person.status ?? 'active',
  });
}

export async function seedGrant(db: AnyExecutor, grant: SeedGrant): Promise<void> {
  await db.insert(roleGrants).values({ ...grant });
}

export async function revokeSeededGrant(db: AnyExecutor, grantId: string, at: Date): Promise<void> {
  await db.update(roleGrants).set({ revokedAt: at }).where(eq(roleGrants.id, grantId));
}

export async function rewriteGrantAudit(db: AnyExecutor, actor: string): Promise<void> {
  await db.update(grantAudit).set({ actor });
}
