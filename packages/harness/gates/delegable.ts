import type { Connector, ExitGate } from '@uw/contracts';

export type ExitShape = { readonly exitGate: ExitGate; readonly connector: Connector };

export function delegableExit(stage: ExitShape): boolean {
  return stage.exitGate === 'human_approval' && stage.connector === 'merge';
}
