import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { AppEnv } from '../../deps.ts';
import { pageHistory, type PageVersion } from '../../pages/history.ts';
import { readPage } from '../../pages/store.ts';
import type { ScreenKernel } from './frame.tsx';
import { moduleCodes, pageNames } from './names.ts';
import { agentQueuesPath, pagePath } from './paths.ts';

export const pageLink =
  'font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';

export const typeWords: Readonly<Record<string, string>> = {
  skill: 'Instructions page',
  persona: 'Agent page',
  learning: 'Learning',
  knowledge: 'Knowledge page',
};

const BACK = /^\/harnesses\/[0-9a-f-]{36}\/controls$/;
const MIRRORED = 'issue';

export function backOf(raw: string | undefined): string | null {
  return raw !== undefined && BACK.test(raw) ? raw : null;
}

export type ShownPage = {
  readonly page: Page;
  readonly versions: readonly PageVersion[];
  readonly canEdit: boolean;
};

export async function shownPage(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  pageId: string,
): Promise<ShownPage | null> {
  const database = c.get('database');
  if (database === null) return null;
  const { actor } = screen.caller;
  const page = await readPage(database.db, actor, pageId, screen.at);
  const versions = await pageHistory(database.db, actor, pageId, screen.at);
  if (page === null || versions === null) return null;
  const mayWrite = can(actor, 'write', { kind: 'area', area: page.jdArea }, screen.at);
  return { page, versions, canEdit: mayWrite && page.type !== MIRRORED };
}

export function pageSpec(page: Page, last: string) {
  return {
    title: page.title,
    current: pagePath(page.id),
    code: moduleCodes.agentQueues,
    crumbs: [
      { label: pageNames.agentQueues, href: agentQueuesPath() },
      { label: page.title, href: pagePath(page.id) },
      { label: last },
    ],
  };
}
