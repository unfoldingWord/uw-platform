import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Hub } from '@uw/harness';
import { contractRequest } from '@uw/harness/port-contracts/connectors';
import type { DatabaseHandle } from '../../database.ts';
import { fixtureApp, fixtureTransport } from '../../github/testing/app-key.ts';
import { fixtureGitHub } from '../../github/testing/fixture-github.ts';
import { hubWiring, platformPorts } from '../../kernel.ts';
import { systemClock } from '../../ports/clock.ts';
import { platformPersonDeps } from '../person-deps.ts';
import { platformGateGitHub } from './gate-github.ts';
import { gateKernel, gateWiring } from './gate-kernel.ts';

const logger = createLogger(
  { traceId: 'trace', commit: 'test-commit', route: 'gate', principal: null },
  () => undefined,
);
const hub: Hub = { wake: async () => undefined };
const untouched: DatabaseHandle = {
  db: {} as Database,
  ping: async () => undefined,
  release: async () => undefined,
};
const secrets = {
  GITHUB_APP_ID: '4242',
  GITHUB_APP_INSTALLATION_ID: '77',
  GITHUB_APP_PRIVATE_KEY: 'pkcs8',
};
const tokenMint = '/app/installations/77/access_tokens';
const pulls = '/repos/unfoldingWord/uw-platform/pulls/7';

describe('GH-6 the gate kernel opens the read client and the ship writes from one GitHub App configuration, and none without it', () => {
  it('reaches GitHub for the refresh and the merge, each with a token from the one App installation', async () => {
    const github = fixtureGitHub();
    const ship = { app: await fixtureApp(), transport: fixtureTransport(github) };
    const wiring = gateWiring(ship, hub, logger);
    expect(wiring.ship).toBe(ship);
    expect(wiring.hub).toBe(hub);
    const ports = platformPorts(untouched, systemClock, wiring);
    expect(await ports.githubFacts.refresh(contractRequest.pullRequest)).toBeNull();
    await ports.connectors.run({ ...contractRequest, connector: 'merge' });
    const paths = github.requests().map((request) => request.path);
    expect(paths.filter((path) => path === tokenMint)).toHaveLength(2);
    expect(paths.filter((path) => path === pulls)).toHaveLength(2);
    expect(paths.every((path) => path === tokenMint || path === pulls)).toBe(true);
  });

  it('wires neither the read client nor the ship writes without a GitHub App configuration', async () => {
    const wiring = gateWiring(null, hub, logger);
    expect(wiring).toEqual(hubWiring(hub));
    const ports = platformPorts(untouched, systemClock, wiring);
    expect(await ports.connectors.run({ ...contractRequest, connector: 'merge' })).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
    await expect(ports.githubFacts.refresh(contractRequest.pullRequest)).rejects.toMatchObject({
      name: 'PortNotWiredError',
    });
    expect(Object.keys(gateKernel(untouched, systemClock, null, hub, logger))).toContain('gates');
  });

  it('opens the person gate GitHub from the App configuration, and nothing when any part is absent', () => {
    const now = () => new Date('2026-10-03T09:00:00.000Z');
    const opened = platformGateGitHub(secrets, now);
    expect(opened?.app).toEqual({ appId: '4242', installationId: '77', privateKey: 'pkcs8' });
    expect(opened?.transport.now()).toEqual(now());
    expect(platformGateGitHub({ ...secrets, GITHUB_APP_PRIVATE_KEY: '' }, now)).toBeNull();
    expect(platformGateGitHub({}, now)).toBeNull();
    expect(platformPersonDeps.gateGitHub).toBe(platformGateGitHub);
  });
});
