import { randomUUID } from 'node:crypto';
import { areaOfCategory } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { post, type Sent } from './commands.ts';

export type Filed = {
  readonly pageId: string;
  readonly title: string;
  readonly sent: Sent;
};

type Overrides = Readonly<Record<string, unknown>>;

export function knowledgeBody(category: string, overrides: Overrides = {}) {
  const pageId = randomUUID();
  return {
    command: 'create_page',
    requestId: randomUUID(),
    pageId,
    type: 'knowledge',
    jdArea: areaOfCategory(category),
    slug: `page-${pageId.slice(0, 8)}`,
    title: 'A knowledge page',
    parentId: null,
    frontmatter: { jd_category: category },
    bodyMd: 'Body.',
    status: 'active',
    ...overrides,
  };
}

export async function fileKnowledge(
  db: Database,
  email: string,
  category: string,
  overrides: Overrides = {},
): Promise<Filed> {
  const body = knowledgeBody(category, overrides);
  const sent = await post(db, email, '/api/pages/commands/create_page', body);
  return { pageId: body.pageId, title: body.title, sent };
}
