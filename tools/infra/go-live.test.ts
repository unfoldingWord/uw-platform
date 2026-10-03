import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

type Block = Record<string, unknown>;
type Binding = { binding?: string; queue?: string; id?: string };
type Queues = {
  consumers?: { queue: string; max_retries?: number; dead_letter_queue?: string }[];
  producers?: Binding[];
};

const goLiveOnly = [
  'logpush',
  'hyperdrive',
  'queues',
  'triggers',
  'durable_objects',
  'migrations',
  'workflows',
  'containers',
];
const accessVars = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_MCP_AUD'];
const apps = ['uw-app', 'uw-ingest'] as const;
const deployedEnvironments = ['staging', 'production'] as const;
const placeholder = 'set-at-go-live';

function load(path: string): Block {
  return parse(readFileSync(path, 'utf8')) as Block;
}

function omit(block: Block, keys: string[]): Block {
  return Object.fromEntries(Object.entries(block).filter(([key]) => !keys.includes(key)));
}

function environments(config: Block): Record<string, Block> {
  return (config['env'] ?? {}) as Record<string, Block>;
}

function withoutGoLiveBindings(config: Block): Block {
  const stripped = Object.fromEntries(
    Object.entries(environments(config)).map(([name, block]) => [
      name,
      { ...omit(block, goLiveOnly), vars: omit((block['vars'] ?? {}) as Block, accessVars) },
    ]),
  );
  return { ...omit(config, goLiveOnly), env: stripped };
}

function goLiveKeysIn(config: Block): string[] {
  const blocks: [string, Block][] = [
    ['top level', config],
    ...Object.entries(environments(config)),
  ];
  return blocks.flatMap(([name, block]) => [
    ...goLiveOnly.filter((key) => key in block).map((key) => `${name}: ${key}`),
    ...accessVars.filter((key) => key in varsOf(block)).map((key) => `${name}: vars.${key}`),
  ]);
}

function environment(app: string, name: string, file: string): Block {
  return environments(load(`infra/${app}/${file}`))[name] ?? {};
}

function queuesOf(block: Block): Queues {
  return (block['queues'] ?? {}) as Queues;
}

function hyperdriveOf(block: Block): Binding[] {
  return (block['hyperdrive'] ?? []) as Binding[];
}

function varsOf(block: Block): Record<string, string> {
  return (block['vars'] ?? {}) as Record<string, string>;
}

const goLive = 'wrangler.go-live.toml';
const live = 'wrangler.toml';
const idShape = new RegExp(`^(${placeholder}|[0-9a-f]{32})$`);

function producerQueue(queues: Queues, binding: string): string {
  return queues.producers?.find((producer) => producer.binding === binding)?.queue ?? '';
}

function expectQueueWiring(name: string): void {
  const app = queuesOf(environment('uw-app', name, goLive));
  const ingest = queuesOf(environment('uw-ingest', name, goLive));
  const events = `uw-ingest-events-${name}`;
  expect(app.consumers).toEqual([
    { queue: events, max_retries: 3, dead_letter_queue: `${events}-dlq` },
  ]);
  expect(producerQueue(ingest, 'INGEST_QUEUE')).toBe(events);
  expect(producerQueue(app, 'INGEST_DLQ')).toBe(`${events}-dlq`);
}

describe('FD-12 the go-live config is the live config plus the bindings whose resources do not exist yet', () => {
  it.each(apps)('%s go-live minus its bindings equals the live file', (app) => {
    const withBindings = withoutGoLiveBindings(load(`infra/${app}/${goLive}`));
    const deployed = withoutGoLiveBindings(load(`infra/${app}/${live}`));
    expect(withBindings).toEqual(deployed);
  });

  it.each(apps)('%s live file declares none of the go-live bindings', (app) => {
    expect(goLiveKeysIn(load(`infra/${app}/${live}`))).toEqual([]);
  });

  it('flags a live file that declares a Durable Object binding or a migration', () => {
    const planted = parse(
      [
        'name = "uw-app"',
        '[[migrations]]',
        'tag = "v1"',
        'new_sqlite_classes = ["HarnessHub"]',
        '[[env.staging.durable_objects.bindings]]',
        'name = "HARNESS_HUB"',
        'class_name = "HarnessHub"',
        '[env.production.vars]',
        'ACCESS_AUD = "x"',
      ].join('\n'),
    ) as Block;
    expect(goLiveKeysIn(planted)).toEqual([
      'top level: migrations',
      'staging: durable_objects',
      'production: vars.ACCESS_AUD',
    ]);
  });
});

type HubBinding = { name?: string; class_name?: string };
type Migration = { tag?: string; new_sqlite_classes?: string[] };

function hubBindingsOf(block: Block): HubBinding[] {
  return ((block['durable_objects'] ?? {}) as { bindings?: HubBinding[] }).bindings ?? [];
}

describe('WB-3 the live hub Durable Object is declared for go-live only', () => {
  it.each(['staging', 'production', 'preview'])(
    '%s binds HARNESS_HUB to the HarnessHub class',
    (name) => {
      expect(hubBindingsOf(environment('uw-app', name, goLive))).toEqual([
        { name: 'HARNESS_HUB', class_name: 'HarnessHub' },
      ]);
    },
  );

  it('binds HARNESS_HUB at the top level and declares HarnessHub as a SQLite class', () => {
    const config = load(`infra/uw-app/${goLive}`);
    expect(hubBindingsOf(config)).toEqual([{ name: 'HARNESS_HUB', class_name: 'HarnessHub' }]);
    expect(config['migrations'] as Migration[]).toEqual([
      { tag: 'v1', new_sqlite_classes: ['HarnessHub'] },
    ]);
  });
});

type WorkflowBlock = { name?: string; binding?: string; class_name?: string };

function workflowSites(config: Block): string[] {
  const blocks: [string, Block][] = [
    ['top level', config],
    ...Object.entries(environments(config)),
  ];
  return blocks.flatMap(([name, block]) =>
    ((block['workflows'] ?? []) as WorkflowBlock[]).map(
      (flow) => `${name}: ${flow.binding ?? ''} ${flow.name ?? ''} ${flow.class_name ?? ''}`,
    ),
  );
}

function strayWorkflows(config: Block): string[] {
  return workflowSites(config).filter(
    (site) => !deployedEnvironments.some((name) => site.startsWith(`${name}: `)),
  );
}

describe('HE-1 the HarnessRun Workflow is declared for go-live only, in staging and production', () => {
  it('binds HARNESS_RUN to the HarnessRun class under staging and production only', () => {
    expect(workflowSites(load(`infra/uw-app/${goLive}`))).toEqual([
      'staging: HARNESS_RUN harness-run-staging HarnessRun',
      'production: HARNESS_RUN harness-run-production HarnessRun',
    ]);
  });

  it('declares no Workflow in the live file', () => {
    expect(workflowSites(load(`infra/uw-app/${live}`))).toEqual([]);
  });

  it('flags a planted Workflow under preview, at the top level, or in the live file', () => {
    const planted = parse(
      [
        '[[workflows]]',
        'name = "harness-run"',
        'binding = "HARNESS_RUN"',
        'class_name = "HarnessRun"',
        '[[env.preview.workflows]]',
        'name = "harness-run-preview"',
        'binding = "HARNESS_RUN"',
        'class_name = "HarnessRun"',
        '[[env.staging.workflows]]',
        'name = "harness-run-staging"',
        'binding = "HARNESS_RUN"',
        'class_name = "HarnessRun"',
      ].join('\n'),
    ) as Block;
    expect(strayWorkflows(planted)).toEqual([
      'top level: HARNESS_RUN harness-run HarnessRun',
      'preview: HARNESS_RUN harness-run-preview HarnessRun',
    ]);
    expect(goLiveKeysIn(planted)).toEqual([
      'top level: workflows',
      'preview: workflows',
      'staging: workflows',
    ]);
  });
});

describe('FD-10 the ingest queue, its producer and its dead-letter queue agree', () => {
  it.each(deployedEnvironments)(
    '%s producer, consumer and dead-letter queue are one wiring',
    (name) => {
      expectQueueWiring(name);
    },
  );

  it.each(deployedEnvironments)('%s binds Hyperdrive as HYPERDRIVE in both Workers', (name) => {
    for (const app of apps) {
      expect(hyperdriveOf(environment(app, name, goLive)).map((entry) => entry.binding)).toEqual([
        'HYPERDRIVE',
      ]);
    }
  });

  it.each(deployedEnvironments)('%s turns Logpush on in both Workers', (name) => {
    for (const app of apps) {
      expect(environment(app, name, goLive)['logpush']).toBe(true);
    }
  });
});

describe('FD-7 the Access variables and ids are placeholders or well formed', () => {
  it.each(apps)('%s Hyperdrive ids are the placeholder or 32 lowercase hex characters', (app) => {
    const blocks = Object.values(environments(load(`infra/${app}/${goLive}`)));
    const ids = blocks.flatMap(hyperdriveOf).map((entry) => entry.id ?? '');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => idShape.test(id))).toBe(true);
  });

  it('uw-app Access AUD tags and team domains are well formed in every environment', () => {
    const blocks = Object.values(environments(load(`infra/uw-app/${goLive}`)));
    const settings = blocks.map(varsOf);
    expect(settings.every((vars) => idShape.test(vars['ACCESS_AUD'] ?? ''))).toBe(true);
    expect(settings.every((vars) => idShape.test(vars['ACCESS_MCP_AUD'] ?? ''))).toBe(true);
    expect(
      settings.every((vars) =>
        /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars['ACCESS_TEAM_DOMAIN'] ?? ''),
      ),
    ).toBe(true);
  });
});

describe('P13 per-PR Workers never register as a queue consumer', () => {
  it.each([live, goLive])('uw-app %s has a preview environment with no queue consumer', (file) => {
    const preview = environment('uw-app', 'preview', file);
    expect(Object.keys(preview).length).toBeGreaterThan(0);
    expect(queuesOf(preview).consumers ?? []).toEqual([]);
  });

  it('only staging and production declare a consumer', () => {
    const consumers = Object.entries(environments(load(`infra/uw-app/${goLive}`)))
      .filter(([, block]) => (queuesOf(block).consumers ?? []).length > 0)
      .map(([name]) => name);
    expect(consumers.sort()).toEqual(['production', 'staging']);
  });
});

describe('P33 preview shares staging Hyperdrive', () => {
  it('binds the same Hyperdrive id in preview as in staging', () => {
    const idOf = (name: string): string | undefined =>
      hyperdriveOf(environment('uw-app', name, goLive))[0]?.id;
    expect(idOf('preview')).toBeDefined();
    expect(idOf('preview')).toBe(idOf('staging'));
  });
});
