import type { Logger } from '@uw/core/log';
import type { Clock, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../../database.ts';
import { createGitHubReads } from '../../github/client.ts';
import { hubWiring, platformKernel, type LiveWiring } from '../../kernel.ts';
import type { ShipGitHub } from '../../ports/connectors.ts';

export function gateWiring(github: ShipGitHub | null, live: LiveWiring, logger: Logger) {
  const wiring = hubWiring(live.hub, { runs: live.runs });
  if (github === null) return wiring;
  const reads = { open: () => createGitHubReads(github.app, github.transport), logger };
  return { ...wiring, reads, ship: github };
}

export function gateKernel(
  database: DatabaseHandle,
  clock: Clock,
  github: ShipGitHub | null,
  live: LiveWiring,
  logger: Logger,
): Kernel {
  return platformKernel(database, clock, gateWiring(github, live, logger));
}
