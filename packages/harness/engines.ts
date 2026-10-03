import { engineSchema, type Engine, type RunShape } from '@uw/contracts';

type EngineKind = 'messages' | 'sandbox' | 'external';
export type EngineDescriptor = {
  readonly key: Engine;
  readonly availability: 'available' | 'reserved';
  readonly kind: EngineKind;
  readonly runShapes: readonly RunShape[];
  readonly defaultProvider: string | null;
  readonly needsHostedBuilder: boolean;
  readonly reviewer: string | null;
};

const descriptors: Readonly<Record<Engine, EngineDescriptor>> = {
  'claude-messages': {
    key: 'claude-messages',
    availability: 'available',
    kind: 'messages',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer',
  },
  'claude-code-sandbox': {
    key: 'claude-code-sandbox',
    availability: 'available',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: true,
    reviewer: null,
  },
  'claude-managed-agent': {
    key: 'claude-managed-agent',
    availability: 'reserved',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: true,
    reviewer: null,
  },
  'codex-sandbox': {
    key: 'codex-sandbox',
    availability: 'available',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'openai',
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer-codex',
  },
  external: {
    key: 'external',
    availability: 'available',
    kind: 'external',
    runShapes: ['external-run'],
    defaultProvider: null,
    needsHostedBuilder: false,
    reviewer: null,
  },
  'openrouter-messages': {
    key: 'openrouter-messages',
    availability: 'available',
    kind: 'messages',
    runShapes: ['workflow-run'],
    defaultProvider: null,
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer',
  },
};

export const SCOUT_ENGINE: Engine = 'openrouter-messages';

const byKey: ReadonlyMap<Engine, EngineDescriptor> = new Map(
  Object.values(descriptors).map((descriptor) => [descriptor.key, descriptor]),
);

export function engineDescriptor(key: Engine): EngineDescriptor {
  const descriptor = byKey.get(engineSchema.parse(key));
  if (descriptor === undefined) throw new Error(`no descriptor for engine ${key}`);
  return descriptor;
}

export function engineDescriptors(): readonly EngineDescriptor[] {
  return engineSchema.options.map(engineDescriptor);
}

export function hostable(key: Engine, shape: RunShape): boolean {
  const descriptor = engineDescriptor(key);
  return descriptor.availability === 'available' && descriptor.runShapes.includes(shape);
}
