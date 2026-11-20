import { randomUUID } from 'node:crypto';
import { areaOfCategory } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
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

const sampleKnowledgeId = '00000000-0000-4000-8000-0000000b00c5';

const sampleBody = [
  'This page gives an overview of how budgeting works, both the theory and the practical tools.',
  '',
  '## Assessment',
  '',
  'The **Operational Assessment** is ==18 percent==, set by the gift acceptance policy.',
  '',
  '> [!IMPORTANT]',
  '> Always say Operational Assessment when you mean the 18 percent.',
  '',
  '## Program costs',
  '',
  '| Program | Operational | Training |',
  '|---|---|---|',
  '| WBWN Chad | 18% | 12% |',
  '| WBWN Sudan | 18% | 5% |',
  '',
  '### Before you start',
  '',
  '- [x] Copy the program template',
  '- [ ] Enter the department number',
  '',
  '<details>',
  '<summary>Change log</summary>',
  '',
  '- 2025-07-01 three programs moved to stage 3',
  '',
  '</details>',
  '',
  'Rows are summed with `=SUM(D3:D9)`. See the [rolling budget](https://example.org/budget).',
].join('\n');

export async function seedSampleKnowledge(db: Database): Promise<string> {
  await seedPage(db, {
    id: sampleKnowledgeId,
    type: 'knowledge',
    status: 'active',
    jdArea: '80-89',
    slug: 'budgeting',
    title: '81.26 Budgeting',
    bodyMd: sampleBody,
    frontmatter: { jd_category: '81', jd_id: '81.26' },
  });
  return sampleKnowledgeId;
}
