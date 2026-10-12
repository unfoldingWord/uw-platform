import type { Connector } from '@uw/contracts';
import type { EffectConnector } from '../ports.ts';

export const connectorRegistry: ReadonlySet<EffectConnector> = new Set<EffectConnector>([
  'merge',
  'deploy',
  'publish',
  'send',
  'post',
]);

export function connectorRegistered(
  connector: Connector,
  registry: ReadonlySet<EffectConnector>,
): boolean {
  return connector === 'none' || registry.has(connector);
}
