import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seedPerson } from '@uw/db/test-seed';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { personByEmail, personById } from './directory.ts';

const ACTIVE_ID = '00000000-0000-4000-8000-000000000951';
const PENDING_ID = '00000000-0000-4000-8000-000000000952';

describe.skipIf(!testServer)('the people directory reads a person by id', () => {
  it('reads an active and a pending person, and nothing for an unknown id', () =>
    withAppDatabase(async (db) => {
      await seedPerson(db, { id: ACTIVE_ID, email: 'dir-active@unfoldingword.org' });
      await seedPerson(db, {
        id: PENDING_ID,
        email: 'dir-pending@example.org',
        status: 'pending',
      });
      expect(await personById(db, ACTIVE_ID)).toEqual({
        personId: ACTIVE_ID,
        email: 'dir-active@unfoldingword.org',
        status: 'active',
      });
      expect((await personById(db, PENDING_ID))?.status).toBe('pending');
      expect(await personById(db, randomUUID())).toBeNull();
    }));
});

describe.skipIf(!testServer)('the people directory reads a person by email', () => {
  it('finds an active person whatever the case and spacing, and not a pending one', () =>
    withAppDatabase(async (db) => {
      await seedPerson(db, { id: ACTIVE_ID, email: 'dir-active@unfoldingword.org' });
      await seedPerson(db, { id: PENDING_ID, email: 'dir-pending@example.org', status: 'pending' });
      expect((await personByEmail(db, ' Dir-Active@UnfoldingWord.org '))?.personId).toBe(ACTIVE_ID);
      expect(await personByEmail(db, 'dir-pending@example.org')).toBeNull();
      expect(await personByEmail(db, 'nobody@example.org')).toBeNull();
    }));
});
