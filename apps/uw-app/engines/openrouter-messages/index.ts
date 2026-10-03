import { notWiredCall, type ModelEngine } from '@uw/harness';
import { messageWork, type EngineAdapter } from '../seam.ts';

export function openrouterMessagesEngine(): EngineAdapter {
  const turn: ModelEngine['turn'] = () => notWiredCall('modelEngine', 'turn');
  return { key: 'openrouter-messages', turn, work: messageWork('openrouter-messages', turn) };
}
