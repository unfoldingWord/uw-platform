import type { Context } from 'hono';
import type { AppEnv } from '../deps.ts';
import { commitOf } from '../env.ts';
import { refuse } from '../http/outcomes.ts';
import { printPageIn } from './print-targets.ts';
import { pdfOfScreen } from './screen.ts';

export async function pdfOfPage(c: Context<AppEnv>, pageId: string): Promise<Response> {
  const database = c.get('database');
  const actor = c.get('principal');
  if (database === null) return refuse(c, 'database_not_configured');
  if (actor === null) return refuse(c, 'unauthenticated');
  const asked = { pageId, at: c.get('now'), commit: commitOf(c.env) };
  const printable = await printPageIn(database.db, actor, asked, 'platform');
  if (printable === null || typeof printable === 'string') return refuse(c, 'page_not_found');
  const { title, bodyHtml, printed, stories } = printable;
  return pdfOfScreen(c, title, bodyHtml, printed, stories);
}
