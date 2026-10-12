import type { EngineConfig } from '../config.ts';
import { messageWork, type EngineAdapter } from '../seam.ts';
import { claudeMessagesTurn } from './turn.ts';

export function claudeMessagesEngine(config: EngineConfig): EngineAdapter {
  const turn = claudeMessagesTurn(config);
  return { key: 'claude-messages', turn, work: messageWork('claude-messages', turn) };
}
