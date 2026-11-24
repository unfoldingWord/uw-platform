import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import type { AppEnv } from '../../deps.ts';
import { pagePrinted } from '../../pdf/page-source.ts';
import type { Printed } from '../../pdf/print-document.ts';
import { wantsPdf } from './frame.tsx';

export async function printedPage(
  c: Context<AppEnv>,
  page: Page,
): Promise<{ readonly printed?: Printed }> {
  const database = c.get('database');
  const actor = c.get('principal');
  if (!wantsPdf(c) || database === null || actor === null) return {};
  return { printed: await pagePrinted({ db: database.db, actor, at: c.get('now') }, page) };
}
