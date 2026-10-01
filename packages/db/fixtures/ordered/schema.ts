import { text, uuid } from 'drizzle-orm/pg-core';
import { declareTable } from '../../declarations.ts';

export const probes = declareTable(
  'probes',
  {
    id: uuid('id').primaryKey(),
    stage: text('stage').notNull(),
    note: text('note').notNull().default(''),
  },
  { classification: 'internal', offlineEligibility: 'never' },
);
