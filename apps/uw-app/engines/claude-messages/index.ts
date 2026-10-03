import { notWiredCall, type ModelEngine } from '@uw/harness';
import { messageWork, type EngineAdapter } from '../seam.ts';

export function claudeMessagesEngine(): EngineAdapter {
  const turn: ModelEngine['turn'] = () => notWiredCall('modelEngine', 'turn');
  return { key: 'claude-messages', turn, work: messageWork('claude-messages', turn) };
}
