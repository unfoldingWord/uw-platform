import { frontmatterSchema, type Page, type PageStatus } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import {
  createPageAs,
  readPage,
  updateCheckedPage,
  type PageRefusal,
  type PageResult,
  type UpdateRequest,
} from './store.ts';

export type GatedSave = {
  readonly pageId: string;
  readonly type: 'measure' | 'dashboard';
  readonly expectedVersion: number | null;
  readonly jdArea: string;
  readonly title: string;
  readonly slug: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly bodyMd: string;
};

type SaveRequest = UpdateRequest;

function refusedWith(reason: PageRefusal['reason'], detail: PageRefusal['detail'] = {}) {
  const refusal: PageRefusal = { ok: false, reason, detail };
  return refusal;
}

function landing(save: GatedSave, expectedVersion: number) {
  return (stored: Page): PageStatus | PageRefusal => {
    if (stored.version !== expectedVersion) return refusedWith('stale_version');
    const moved = [
      ...(stored.type === save.type ? [] : ['type']),
      ...(stored.jdArea === save.jdArea ? [] : ['jdArea']),
    ];
    if (moved.length > 0) return refusedWith('malformed_command', { fields: moved });
    if (stored.status === 'retired') return refusedWith('not_permitted', { why: 'retired_page' });
    return 'suggested';
  };
}

function created(db: Database, actor: Principal, save: GatedSave, request: SaveRequest) {
  const command = {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId: save.pageId,
    type: save.type,
    jdArea: save.jdArea,
    slug: save.slug,
    title: save.title,
    parentId: null,
    frontmatter: frontmatterSchema.parse(save.frontmatter),
    bodyMd: save.bodyMd,
    status: 'suggested' as const,
  };
  return createPageAs(db, actor, command, {
    traceId: request.traceId,
    at: request.at,
    writer: null,
  });
}

export async function saveGatedPageAsAgent(
  db: Database,
  actor: Principal,
  save: GatedSave,
  request: SaveRequest,
): Promise<PageResult | PageRefusal> {
  if (save.expectedVersion === null) return created(db, actor, save, request);
  const stored = await readPage(db, actor, save.pageId, request.at);
  if (stored === null) return refusedWith('page_not_found', { pageId: save.pageId });
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: save.pageId,
    expectedVersion: save.expectedVersion,
    slug: save.slug,
    title: save.title,
    parentId: stored.parentId,
    frontmatter: frontmatterSchema.parse(save.frontmatter),
    bodyMd: save.bodyMd,
  };
  const checked = { command, statusFor: landing(save, save.expectedVersion) };
  return updateCheckedPage(db, actor, checked, request);
}
