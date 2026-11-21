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
  'This page explains how to prepare for a team trip, both the planning and the practical tools.',
  '',
  '## Planning',
  '',
  'The **Trip Lead** is ==named a month ahead==, chosen by the travelling team.',
  '',
  '> [!IMPORTANT]',
  '> Always say Trip Lead when you mean the person who books the travel.',
  '',
  '## Packing list',
  '',
  '| Item | Carry-on | Checked |',
  '|---|---|---|',
  '| Laptop | Yes | No |',
  '| Spare charger | Yes | Yes |',
  '',
  '### Before you start',
  '',
  '- [x] Copy the trip template',
  '- [ ] Enter the travel dates',
  '',
  '<details>',
  '<summary>Change log</summary>',
  '',
  '- 2025-07-01 three checklists moved to the new template',
  '',
  '</details>',
  '',
  'Rows are counted with `=COUNTA(D3:D9)`. See the [travel guide](https://example.org/travel).',
].join('\n');

export async function seedSampleKnowledge(db: Database): Promise<string> {
  await seedPage(db, {
    id: sampleKnowledgeId,
    type: 'knowledge',
    status: 'active',
    jdArea: '80-89',
    slug: 'travel-checklist',
    title: '81.26 Travel Checklist',
    bodyMd: sampleBody,
    frontmatter: { jd_category: '81', jd_id: '81.26' },
  });
  return sampleKnowledgeId;
}
