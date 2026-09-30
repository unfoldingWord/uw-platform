import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { declareTable } from '../../declarations.ts';

export const declared = declareTable(
  'declared',
  { id: uuid('id').primaryKey() },
  { classification: 'public', offlineEligibility: 'sync' },
);

export const bare = pgTable('bare', { id: uuid('id').primaryKey() });
