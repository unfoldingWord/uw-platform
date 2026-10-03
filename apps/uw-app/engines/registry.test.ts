import { engineSchema, type Engine } from '@uw/contracts';
import { EngineNotAvailableError, type ToolCaller } from '@uw/harness';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { platformModelEngine, spendNotWired } from '../ports/model-engine.ts';
import {
  engineAdapter,
  engineFactories,
  engineRegistryOf,
  registryFrom,
  type EngineFactory,
} from './registry.ts';
import { engineConfigOf } from './config.ts';
import { messageWork, type EngineAdapter, type EngineWork } from './seam.ts';

const config = { fetch: () => Promise.reject(new Error('no network in tests')) };

const work: EngineWork = {
  runId: 'run-1',
  itemId: 'item-1',
  traceId: 'trace-1',
  persona: 'agent:builder',
  model: 'model',
  pinnedProvider: 'anthropic',
  instructions: 'Work.',
  prompt: 'Begin.',
  toolset: ['read_page'],
  tools: { call: () => Promise.reject(new Error('no tools')) },
  onTurn: async () => undefined,
};

function stub(key: Engine): EngineFactory {
  return () => ({ key, turn: null, work: () => Promise.reject(new Error(key)) });
}

function factoriesWith(
  change: (keys: Engine[]) => Engine[],
): readonly (readonly [Engine, EngineFactory])[] {
  return change([...engineSchema.options]).map((key) => [key, stub(key)] as const);
}

function turnRequest(engine: Engine) {
  return {
    engine,
    model: 'model',
    pinnedProvider: null,
    persona: 'agent:builder',
    instructions: 'Work.',
    tools: [],
    messages: [{ role: 'user' as const, text: 'Begin.' }],
    traceId: 'trace-1',
  };
}

async function sixKeys(): Promise<void> {
  const registry = engineRegistryOf(config);
  expect([...registry.keys()].sort()).toEqual([...engineSchema.options].sort());
  for (const key of engineSchema.options) expect(engineAdapter(registry, key).key).toBe(key);
  expect(new Set(engineFactories.map(([, factory]) => factory)).size).toBe(6);
}

async function refusedAtConstruction(): Promise<void> {
  const missing = factoriesWith((keys) => keys.slice(1));
  expect(() => registryFrom(missing, config)).toThrow('claude-messages');
  const duplicated = factoriesWith((keys) => [...keys, 'external']);
  expect(() => registryFrom(duplicated, config)).toThrow('external');
  const misnamed = factoriesWith((keys) => keys).map(([key, factory]) =>
    key === 'codex-sandbox' ? ([key, stub('external')] as const) : ([key, factory] as const),
  );
  expect(() => registryFrom(misnamed, config)).toThrow('codex-sandbox');
}

async function unavailable(key: Engine): Promise<void> {
  const registry = engineRegistryOf(config);
  const engine = platformModelEngine(registry, spendNotWired);
  await expect(engine.turn(turnRequest(key))).rejects.toBeInstanceOf(EngineNotAvailableError);
  await expect(engine.turn(turnRequest(key))).rejects.toMatchObject({ engine: key });
  await expect(engineAdapter(registry, key).work(work)).rejects.toMatchObject({
    name: 'EngineNotAvailableError',
    engine: key,
  });
}

async function messageWorkLoops(): Promise<void> {
  const turn = async () => ({
    toolCalls: [],
    text: 'done',
    stopReason: 'end_turn' as const,
    usage: { inputTokens: 7, outputTokens: 3, costMicros: 42, costBasis: 'metered' as const },
    resolvedProvider: 'anthropic',
    resolvedModel: 'model-1',
  });
  expect(await messageWork('claude-messages', turn)(work)).toEqual({
    outcome: 'ended',
    text: 'done',
    inputTokens: 7,
    outputTokens: 3,
    costMicros: 42,
    computeMinor: null,
    resolvedProvider: 'anthropic',
    resolvedModel: 'model-1',
    toolsCalled: [],
  });
}

function configReadsItsNames(): void {
  const fetch = config.fetch;
  const env = { ANTHROPIC_API_KEY: 'key', COMMIT_SHA: 'abc', ALWAYS_ON_MODEL: 'm' };
  const read = engineConfigOf(env, fetch);
  expect(read.ANTHROPIC_API_KEY).toBe('key');
  expect(read.ALWAYS_ON_MODEL).toBe('m');
  expect(read.fetch).toBe(fetch);
  expect(Object.keys(read)).not.toContain('COMMIT_SHA');
}

describe('the engine registry', () => {
  it('a message engine works through the tool loop and reports no compute', messageWorkLoops);

  it(
    'the engine configuration reads only its settings and the injected fetch',
    configReadsItsNames,
  );

  it('HE-2 the registry holds exactly the six engine keys, each from its own directory', sixKeys);

  it(
    'HE-2 the registry refuses a missing, duplicated or misnamed engine at construction',
    refusedAtConstruction,
  );

  it('HE-10 claude-managed-agent answers engine_not_available for a turn and for work', () =>
    unavailable('claude-managed-agent'));

  it('external never runs on the platform', () => unavailable('external'));

  it('the engines not yet built answer not_wired for their work', async () => {
    const registry = engineRegistryOf(config);
    for (const key of ['claude-code-sandbox', 'codex-sandbox'] as const) {
      await expect(engineAdapter(registry, key).work(work)).rejects.toMatchObject({
        name: 'PortNotWiredError',
      });
    }
  });

  it('HE-2 the work an engine receives reaches the platform only through the MCP tool caller', () => {
    expectTypeOf<keyof EngineWork>().toEqualTypeOf<
      | 'runId'
      | 'itemId'
      | 'traceId'
      | 'persona'
      | 'model'
      | 'pinnedProvider'
      | 'instructions'
      | 'prompt'
      | 'toolset'
      | 'tools'
      | 'onTurn'
    >();
    expectTypeOf<EngineWork['tools']>().toEqualTypeOf<ToolCaller>();
    expectTypeOf<EngineAdapter['work']>().parameters.toEqualTypeOf<[EngineWork]>();
  });
});
