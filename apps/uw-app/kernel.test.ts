import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Hub } from '@uw/harness';
import { contractRequest } from '@uw/harness/port-contracts/connectors';
import type { DatabaseHandle } from './database.ts';
import { createGitHubReads } from './github/client.ts';
import { fixtureApp, fixtureTransport } from './github/testing/app-key.ts';
import { fixtureGitHub } from './github/testing/fixture-github.ts';
import { hubWiring, platformKernel, platformPorts, runWiring } from './kernel.ts';
import { systemClock } from './ports/clock.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

const portNames = [
  'clock',
  'ids',
  'store',
  'grants',
  'githubFacts',
  'connectors',
  'modelEngine',
  'hub',
  'notifier',
  'runs',
];

const expected = {
  clock: systemClock,
  ids: randomIds,
  store: storeNotWired,
  grants: grantsNotWired,
  githubFacts: githubFactsNotWired,
  modelEngine: modelEngineNotWired,
  hub: hubNotWired,
  notifier: notifierNotWired,
  runs: runsNotWired,
};

const pulls = '/repos/unfoldingWord/uw-platform/pulls/7';
const silentLogger = createLogger(
  { traceId: 'trace', commit: 'test-commit', route: 'kernel', principal: null },
  () => undefined,
);
const untouched: DatabaseHandle = {
  db: {} as Database,
  ping: async () => undefined,
  release: async () => undefined,
};
const recordingHub: Hub = { wake: async () => undefined };

function mismatched(): Record<string, unknown> {
  const ports = platformPorts(null);
  return Object.fromEntries(
    Object.entries(expected).filter(([name, adapter]) => Reflect.get(ports, name) !== adapter),
  );
}

async function fixtureWiring() {
  const github = fixtureGitHub();
  const ship = { app: await fixtureApp(), transport: fixtureTransport(github) };
  const reads = { open: () => createGitHubReads(ship.app, ship.transport), logger: silentLogger };
  return { github, wiring: { ...hubWiring(recordingHub), reads, ship } };
}

function pullReads(github: ReturnType<typeof fixtureGitHub>): number {
  return github.requests().filter((request) => request.path === pulls).length;
}

describe('DX-1 the Worker builds the kernel over platform adapters', () => {
  it('uses the platform clock and ids, and not-wired adapters for the services later steps build', () => {
    expect(Object.keys(platformPorts(null))).toEqual(portNames);
    expect(mismatched()).toEqual({});
  });

  it('reports a Worker with no database as a store that is not wired', async () => {
    await expect(platformKernel(null).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
    });
  });
});

describe('GH-6 platformPorts wires the merge connector only when given the ship GitHub, and refresh only when given a read client', () => {
  it('answers the merge as not wired and refuses the refresh with the hub wiring alone', async () => {
    const { connectors, githubFacts } = platformPorts(
      untouched,
      systemClock,
      hubWiring(recordingHub),
    );
    expect(await connectors.run({ ...contractRequest, connector: 'merge' })).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
    await expect(githubFacts.refresh(contractRequest.pullRequest)).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'githubFacts',
    });
  });

  it('reaches GitHub through the merge connector and the refresh when given both', async () => {
    const { github, wiring } = await fixtureWiring();
    const { connectors, githubFacts } = platformPorts(untouched, systemClock, wiring);
    await connectors.run({ ...contractRequest, connector: 'merge' });
    expect(pullReads(github)).toBe(1);
    expect(await githubFacts.refresh(contractRequest.pullRequest)).toBeNull();
    expect(pullReads(github)).toBe(2);
  });
});

describe('every platform kernel is given the hub it is wired with', () => {
  it('passes the wired hub to the ports, and the not-wired hub when no wiring is given', async () => {
    const { wiring } = await fixtureWiring();
    expect(platformPorts(null, systemClock, hubWiring(recordingHub)).hub).toBe(recordingHub);
    expect(platformPorts(untouched, systemClock, wiring).hub).toBe(recordingHub);
    expect(platformPorts(untouched).hub).toBe(hubNotWired);
  });
});

const contractReview = {
  reviewer: 'uw-reviewer',
  repository: 'unfoldingWord/uw-platform',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  head: 'f'.repeat(40),
  verdict: 'approve' as const,
  body: 'Approved.',
  traceId: 'b1000000-0000-4000-8000-000000000004',
};

describe('HE-4 only the run wiring holds the Reviewer review writes', () => {
  it('posts a review through the run wiring and answers not_wired through the hub wiring', async () => {
    const github = fixtureGitHub();
    github.on('POST', '/repos/unfoldingWord/uw-platform/pulls/7/reviews', {
      status: 200,
      body: { id: 9400000003 },
    });
    const reviews = {
      apps: new Map([['uw-reviewer', await fixtureApp()]]),
      transport: fixtureTransport(github),
    };
    const host = { hub: recordingHub, runs: runsNotWired, modelEngine: modelEngineNotWired };
    const run = platformPorts(untouched, systemClock, runWiring(host, null, reviews));
    expect(await run.connectors.review(contractReview)).toEqual({
      outcome: 'posted',
      reviewId: 9400000003,
    });
    const hub = platformPorts(untouched, systemClock, hubWiring(recordingHub));
    expect(await hub.connectors.review(contractReview)).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
    expect(hubWiring(recordingHub).reviews).toBeNull();
    const carried = { ...host, reviews, reads: reviews, ship: reviews };
    expect(hubWiring(recordingHub, carried)).toMatchObject({
      reviews: null,
      reads: null,
      ship: null,
    });
  });
});
