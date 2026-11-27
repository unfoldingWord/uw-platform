import { identitySchema, type Principal } from '@uw/contracts';
import { allowed, type PageAppended, type PageAppends } from '@uw/harness';

type SimPage = { readonly jdArea: string; bodyMd: string; version: number };
type Appended = {
  readonly pageId: string;
  readonly actor: string;
  readonly block: string;
  readonly version: number;
};

export type SimPageAppends = PageAppends & {
  addPage(pageId: string, jdArea: string, bodyMd: string): void;
  page(pageId: string): { readonly bodyMd: string; readonly version: number } | null;
  appended(): readonly Appended[];
};

const simPersonId = 'c7000000-0000-4000-8000-0000000000a1';

export function simPrincipalWith(role: 'editor' | 'viewer', area: string): Principal {
  return {
    identity: identitySchema.parse(`human:${simPersonId}`),
    kind: 'person',
    personId: simPersonId,
    email: 'ana@example.org',
    grants: [
      {
        grantId: 'c7000000-0000-4000-8000-0000000000b1',
        role,
        scopeKind: 'jd_area',
        scopeArea: area,
        expiresAt: null,
      },
    ],
    interactive: true,
  };
}

export function createSimPageAppends(now: () => Date = () => new Date()): SimPageAppends {
  const pages = new Map<string, SimPage>();
  const done = new Map<string, Appended>();
  const append: PageAppends['append'] = async (actor, change): Promise<PageAppended> => {
    const repeated = done.get(change.requestId);
    if (repeated !== undefined) return { outcome: 'appended', version: repeated.version };
    const page = pages.get(change.pageId);
    if (page === undefined || !allowed(actor, 'read', page, now())) {
      return { outcome: 'page_not_found' };
    }
    if (!allowed(actor, 'write', page, now())) return { outcome: 'not_permitted' };
    page.bodyMd = `${page.bodyMd}\n\n${change.block}`;
    page.version += 1;
    const record = {
      pageId: change.pageId,
      actor: actor.identity,
      block: change.block,
      version: page.version,
    };
    done.set(change.requestId, record);
    return { outcome: 'appended', version: page.version };
  };
  return {
    append,
    addPage: (pageId, jdArea, bodyMd) => {
      pages.set(pageId, { jdArea, bodyMd, version: 1 });
    },
    page: (pageId) => {
      const found = pages.get(pageId);
      return found === undefined ? null : { bodyMd: found.bodyMd, version: found.version };
    },
    appended: () => [...done.values()],
  };
}
