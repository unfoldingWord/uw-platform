import { engineSchema, type Engine } from '@uw/contracts';
import { EngineNotAvailableError } from '@uw/harness';
import { claudeCodeSandboxEngine } from './claude-code-sandbox/index.ts';
import { claudeManagedAgentEngine } from './claude-managed-agent/index.ts';
import { claudeMessagesEngine } from './claude-messages/index.ts';
import { codexSandboxEngine } from './codex-sandbox/index.ts';
import type { EngineConfig } from './config.ts';
import { externalEngine } from './external/index.ts';
import { openrouterMessagesEngine } from './openrouter-messages/index.ts';
import type { EngineAdapter } from './seam.ts';

export type EngineFactory = (config: EngineConfig) => EngineAdapter;
export type EngineRegistry = ReadonlyMap<Engine, EngineAdapter>;

export const engineFactories: readonly (readonly [Engine, EngineFactory])[] = [
  ['claude-messages', claudeMessagesEngine],
  ['openrouter-messages', openrouterMessagesEngine],
  ['claude-code-sandbox', claudeCodeSandboxEngine],
  ['codex-sandbox', codexSandboxEngine],
  ['claude-managed-agent', claudeManagedAgentEngine],
  ['external', externalEngine],
];

export function registryFrom(
  factories: readonly (readonly [Engine, EngineFactory])[],
  config: EngineConfig,
): EngineRegistry {
  const registry = new Map<Engine, EngineAdapter>();
  for (const [key, factory] of factories) {
    if (registry.has(key)) throw new Error(`the engine registry names ${key} twice`);
    const adapter = factory(config);
    if (adapter.key !== key) throw new Error(`the engine registered as ${key} is ${adapter.key}`);
    registry.set(key, adapter);
  }
  const missing = engineSchema.options.filter((key) => !registry.has(key));
  if (missing.length > 0) throw new Error(`the engine registry has no ${missing.join(', ')}`);
  return registry;
}

export function engineRegistryOf(config: EngineConfig): EngineRegistry {
  return registryFrom(engineFactories, config);
}

export function engineAdapter(registry: EngineRegistry, key: Engine): EngineAdapter {
  const adapter = registry.get(key);
  if (adapter === undefined) throw new EngineNotAvailableError(key);
  return adapter;
}
