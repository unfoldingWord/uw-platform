import { uuid } from 'drizzle-orm/pg-core';
import { declareTable } from '../../declarations.ts';

export const unmigrated = declareTable(
  'unmigrated',
  { id: uuid('id').primaryKey() },
  { classification: 'internal', offlineEligibility: 'never' },
);
