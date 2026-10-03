import type { EngineConfig } from '../config.ts';
import { messageWork, type EngineAdapter } from '../seam.ts';
import { openrouterMessagesTurn } from './turn.ts';

export function openrouterMessagesEngine(config: EngineConfig): EngineAdapter {
  const turn = openrouterMessagesTurn(config);
  return { key: 'openrouter-messages', turn, work: messageWork('openrouter-messages', turn) };
}
