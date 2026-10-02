import type { Connector } from '@uw/contracts';
import type { EffectConnector } from '../ports.ts';

export const connectorRegistry: ReadonlySet<EffectConnector> = new Set<EffectConnector>([
  'merge',
  'publish',
]);

export function connectorRegistered(connector: Connector): boolean {
  return connector === 'none' || connectorRegistry.has(connector);
}
