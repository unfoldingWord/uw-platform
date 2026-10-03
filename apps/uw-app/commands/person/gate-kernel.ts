import type { Logger } from '@uw/core/log';
import type { Clock, Hub, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../../database.ts';
import { createGitHubReads } from '../../github/client.ts';
import { hubWiring, platformKernel } from '../../kernel.ts';
import type { ShipGitHub } from '../../ports/connectors.ts';

export function gateWiring(github: ShipGitHub | null, hub: Hub, logger: Logger) {
  if (github === null) return hubWiring(hub);
  const reads = { open: () => createGitHubReads(github.app, github.transport), logger };
  return { ...hubWiring(hub), reads, ship: github };
}

export function gateKernel(
  database: DatabaseHandle,
  clock: Clock,
  github: ShipGitHub | null,
  hub: Hub,
  logger: Logger,
): Kernel {
  return platformKernel(database, clock, gateWiring(github, hub, logger));
}
