import { describe, expect, it } from 'vitest';
import { platformPageSlug } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, harnessOf, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';
import type { SeededPage } from './store-gateways.ts';

type JoiningSubject = () => {
  readonly store: Store;
  seedPage(page: SeededPage): Promise<void>;
};

const pullRequest = { repo: 'unfoldingWord/tc-admin-app', number: 12 };

function platformPage(jdArea: string): SeededPage {
  return {
    id: uid(0x7001),
    type: 'platform',
    status: 'active',
    jdArea,
    title: 'Platform',
    bodyMd: 'The repositories the platform may dispatch onto.',
    frontmatter: { dispatch_allowed: [pullRequest.repo] },
    slug: platformPageSlug,
  };
}

function describeByPullRequest(subject: JoiningSubject): void {
  it('DX-3 finds the item on a pull request in its harness in any case, and nothing elsewhere', async () => {
    const joined = itemOf(0x7100, 1, { pullRequest, expectedHead: 'a'.repeat(40) });
    const found = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x7100, 'gateway-joined');
      await tx.harnessItems.write.insert(joined, at);
      return {
        same: await tx.harnessItems.read.byPullRequest(uid(0x7100), {
          repo: 'UNFOLDINGWORD/TC-ADMIN-APP',
          number: 12,
        }),
        other: await tx.harnessItems.read.byPullRequest(uid(0x7100), {
          ...pullRequest,
          number: 13,
        }),
        elsewhere: await tx.harnessItems.read.byPullRequest(uid(0x7200), pullRequest),
      };
    });
    expect(found).toEqual({ same: joined, other: null, elsewhere: null });
  });

  it('DX-3 returns the earliest-created item when two items sit on one pull request', async () => {
    const head = 'a'.repeat(40);
    const later = itemOf(0x7110, 1, { pullRequest, expectedHead: head, branchState: 'active' });
    const earlier = itemOf(0x7110, 2, { pullRequest, expectedHead: head });
    const found = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x7110, 'gateway-twice');
      await tx.harnessItems.write.insert(later, new Date(at.getTime() + 60_000));
      await tx.harnessItems.write.insert(earlier, at);
      return tx.harnessItems.read.byPullRequest(uid(0x7110), pullRequest);
    });
    expect(found).toEqual(earlier);
  });
}

function describePlatformFor(subject: JoiningSubject): void {
  it('DX-3 reads the platform page of an area by type and slug, and nothing for another area', async () => {
    await subject().seedPage(platformPage('70-79'));
    const read = await subject().store.transaction(async (tx) => ({
      area: await tx.pages.read.platformFor('70-79'),
      other: await tx.pages.read.platformFor('60-69'),
    }));
    expect(read.area).toMatchObject({
      id: uid(0x7001),
      type: 'platform',
      status: 'active',
      frontmatter: { dispatch_allowed: [pullRequest.repo] },
    });
    expect(read.other).toBeNull();
  });

  it('DX-3 reads the platform page whatever its status', async () => {
    await subject().seedPage({ ...platformPage('50-59'), id: uid(0x7002), status: 'suggested' });
    const read = await subject().store.transaction((tx) => tx.pages.read.platformFor('50-59'));
    expect(read).toMatchObject({ id: uid(0x7002), type: 'platform', status: 'suggested' });
  });
}

function describeSetShadow(subject: JoiningSubject): void {
  it('DX-3 stores shadow and the external reviewers, and lifts shadow', async () => {
    const harness = {
      ...harnessOf(0x7300, 'gateway-shadow'),
      shadow: true,
      externalReviewerIdentities: ['uwreview[bot]'],
    };
    const read = await subject().store.transaction(async (tx) => {
      await tx.harnesses.write.insert(harness, at);
      const before = await tx.harnesses.read.byId(harness.id);
      const lifted = await tx.harnesses.write.setShadow(harness.id, false);
      const missing = await tx.harnesses.write.setShadow(uid(0x7399), false);
      return { before, lifted, missing, after: await tx.harnesses.read.byId(harness.id) };
    });
    expect(read).toEqual({
      before: harness,
      lifted: true,
      missing: false,
      after: { ...harness, shadow: false },
    });
  });
}

export function describeStoreJoining(adapter: string, subject: JoiningSubject): void {
  describe(`store reads for joining on ${adapter}`, () => {
    describeByPullRequest(subject);
    describePlatformFor(subject);
    describeSetShadow(subject);
  });
}
