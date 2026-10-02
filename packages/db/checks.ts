import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  humanIdentityPattern,
  identityPattern,
  jdAreaPattern,
  personaIdentityPattern,
  stageKeyPattern,
} from '@uw/contracts';

const plainWord = /^[a-z0-9_-]+$/;

export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const unsafe = values.filter((value) => !plainWord.test(value));
  if (unsafe.length > 0) {
    throw new TypeError(`closed-set values must be plain words: ${unsafe.join(', ')}`);
  }
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}

export function subsetOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const unsafe = values.filter((value) => !plainWord.test(value));
  if (unsafe.length > 0) {
    throw new TypeError(`closed-set values must be plain words: ${unsafe.join(', ')}`);
  }
  return sql`${column} <@ ARRAY[${sql.raw(values.map((value) => `'${value}'`).join(', '))}]::text[]`;
}

export function matches(column: AnyPgColumn, pattern: string): SQL {
  if (pattern.includes("'")) throw new TypeError('a CHECK pattern may not contain a quote');
  return sql`${column} ~ ${sql.raw(`'${pattern}'`)}`;
}

export const JD_AREA_PATTERN = jdAreaPattern;
export const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';
export const IDENTITY_PATTERN = identityPattern;
export const STAGE_KEY_PATTERN = stageKeyPattern;
export const PERSONA_IDENTITY_PATTERN = personaIdentityPattern;
export const HUMAN_IDENTITY_PATTERN = humanIdentityPattern;
