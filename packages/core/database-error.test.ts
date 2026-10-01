import { describe, expect, it } from 'vitest';
import { databaseErrorFacts } from './database-error.ts';

describe('FD-11 database error facts', () => {
  it('reads code, constraint and table from the error itself', () => {
    const error = Object.assign(new Error('x'), {
      code: '23505',
      constraint_name: 'people_email_key',
      table_name: 'people',
    });
    expect(databaseErrorFacts(error)).toMatchObject({
      code: '23505',
      constraint: 'people_email_key',
      table: 'people',
    });
  });

  it('reads the constraint field PGlite uses, from a cause', () => {
    const error = new Error('wrapped', { cause: { code: '23514', constraint: 'c' } });
    expect(databaseErrorFacts(error)).toMatchObject({
      code: '23514',
      constraint: 'c',
      table: null,
    });
  });

  it('is null for an error that is not from the database', () => {
    expect(databaseErrorFacts(new Error('plain'))).toBeNull();
    expect(databaseErrorFacts('text')).toBeNull();
  });
});
