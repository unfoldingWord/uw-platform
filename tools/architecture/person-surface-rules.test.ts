import { afterEach, describe, expect, it } from 'vitest';
import { leaf, removePlanted, violations } from './planted-cruise.ts';

afterEach(removePlanted);

const gateKernelFile = 'apps/uw-app/commands/person/gate-kernel.ts';
const gateGitHubFile = 'apps/uw-app/commands/person/gate-github.ts';
const personSurface = {
  [gateKernelFile]: leaf,
  [gateGitHubFile]: leaf,
  'apps/uw-app/commands/person-deps.ts': leaf,
  'apps/uw-app/commands/person/x.ts': leaf,
  'apps/uw-app/commands/dispatch.ts': leaf,
  'apps/uw-app/commands/requests.ts': leaf,
};

const surfaceRefusals: [string, string, string, string][] = [
  [
    'a gate command building the gate kernel',
    'apps/uw-app/commands/person/gates.ts',
    "import { gateKernel } from './gate-kernel.ts';",
    'gate-kernel-only-in-capabilities',
  ],
  [
    'a gate command opening the gate GitHub',
    'apps/uw-app/commands/person/gates.ts',
    "import { platformGateGitHub } from './gate-github.ts';",
    'gate-github-only-in-person-deps',
  ],
  [
    'the command capabilities opening the gate GitHub',
    'apps/uw-app/commands/capabilities.ts',
    "import './person/gate-github.ts';",
    'gate-github-only-in-person-deps',
  ],
  [
    'the dispatcher building the gate kernel',
    'apps/uw-app/commands/dispatch.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-capabilities',
  ],
  [
    'the person deps building the gate kernel',
    'apps/uw-app/commands/person-deps.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-capabilities',
  ],
  [
    'another person command opening the gate GitHub',
    'apps/uw-app/commands/person/stages.ts',
    "import './gate-github.ts';",
    'gate-github-only-in-person-deps',
  ],
  [
    'the MCP routes building the gate kernel',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/person/gate-kernel.ts';",
    'gate-kernel-only-in-capabilities',
  ],
  [
    'a non-gate person command reaching the person deps',
    'apps/uw-app/commands/person/stages.ts',
    "import { platformPersonDeps } from '../person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'a page module reaching the person deps',
    'apps/uw-app/pages/a.ts',
    "import { platformPersonDeps } from '../commands/person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'the dispatcher reaching the person deps',
    'apps/uw-app/commands/dispatch.ts',
    "import type { PersonDeps } from './person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'a page module opening the gate GitHub',
    'apps/uw-app/pages/a.ts',
    "import { platformGateGitHub } from '../commands/person/gate-github.ts';",
    'gate-github-only-in-person-deps',
  ],
  [
    'a type-only import of the gate kernel from another person command',
    'apps/uw-app/commands/person/stages.ts',
    "import type { gateKernel } from './gate-kernel.ts';",
    'gate-kernel-only-in-capabilities',
  ],
  [
    'a dynamic import of the gate GitHub from the dispatcher',
    'apps/uw-app/commands/dispatch.ts',
    "export const opener = () => import('./person/gate-github.ts');",
    'gate-github-only-in-person-deps',
  ],
  [
    'a route reaching the person surface',
    'apps/uw-app/http/a.ts',
    "import '../commands/person/x.ts';",
    'person-surface-only-from-commands',
  ],
  [
    'the MCP routes reaching the person surface',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/person/x.ts';",
    'person-surface-only-from-commands',
  ],
  [
    'the MCP routes reaching the command API',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'an MCP test reaching the gate kernel',
    'apps/uw-app/mcp/a.test.ts',
    "import '../commands/person/gate-kernel.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'an engine reaching the command API',
    'apps/uw-app/engines/e/a.ts',
    "import '../../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'the queue root reaching the command API',
    'apps/uw-app/queue/worker.ts',
    "import '../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'the cron root reaching the gate GitHub',
    'apps/uw-app/cron/github-sweep.ts',
    "import '../commands/person/gate-github.ts';",
    'cron-imports-only-the-request-ledger',
  ],
  [
    'the cron reaching the dispatcher',
    'apps/uw-app/cron/request-retention.ts',
    "import '../commands/dispatch.ts';",
    'cron-imports-only-the-request-ledger',
  ],
  [
    'the queue reaching the request ledger',
    'apps/uw-app/queue/worker.ts',
    "import '../commands/requests.ts';",
    'agent-hosts-never-import-commands',
  ],
];

describe('confirmation is reached only from the page routes', () => {
  const confirm = { 'apps/uw-app/pages/confirm.ts': leaf };

  it.each([
    ['the MCP verbs', 'apps/uw-app/mcp/verbs/write-page.ts', "import '../../pages/confirm.ts';"],
    ['the agent page writer', 'apps/uw-app/pages/agent-write.ts', "import './confirm.ts';"],
    ['the command API', 'apps/uw-app/commands/dispatch.ts', "import '../pages/confirm.ts';"],
  ])('refuses %s importing it', async (_name, path, source) => {
    const found = await violations({ ...confirm, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(
      'confirm-page-only-from-page-routes',
    );
  });

  it('allows the page routes and a test', async () => {
    const found = await violations({
      ...confirm,
      'apps/uw-app/pages/routes.ts': "import './confirm.ts';",
      'apps/uw-app/pages/confirm.pg.test.ts': "import './confirm.ts';",
    });
    expect(found).toEqual([]);
  });
});

const appActivation = 'apps/uw-app/commands/person/persona-activation.ts';
const activationFiles = {
  [appActivation]: leaf,
  'packages/harness/personas/commands.ts': leaf,
  'packages/harness/personas/activate.ts': leaf,
  'packages/harness/personas/flip.ts': leaf,
};

const activationRefusals: [string, string, string, string][] = [
  [
    'the package index re-exporting the activation',
    'packages/harness/index.ts',
    "export * from './persona-activation.ts';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'the kernel building the persona commands',
    'packages/harness/kernel.ts',
    "import './personas/commands.ts';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'another kernel module reaching the flip',
    'packages/harness/runs/beat.ts',
    "import '../personas/flip.ts';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'an MCP verb building the activation',
    'apps/uw-app/mcp/verbs/a.ts',
    "import { createPersonaActivation } from '@uw/harness/persona-activation';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'the agent page writer building the activation',
    'apps/uw-app/pages/agent-write.ts',
    "import '@uw/harness/persona-activation';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'the command capabilities building the activation from the kernel package',
    'apps/uw-app/commands/capabilities.ts',
    "import '@uw/harness/persona-activation';",
    'persona-activation-only-in-the-person-surface',
  ],
  [
    'the dispatcher reaching the person activation',
    'apps/uw-app/commands/dispatch.ts',
    "import './person/persona-activation.ts';",
    'persona-activation-only-in-capabilities',
  ],
  [
    'another person command reaching the person activation',
    'apps/uw-app/commands/person/gates.ts',
    "import './persona-activation.ts';",
    'persona-activation-only-in-capabilities',
  ],
];

describe('persona activation is built only for the person activation command', () => {
  it.each(activationRefusals)('refuses %s', async (_name, path, source, rule) => {
    const found = await violations({ ...activationFiles, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('allows the capabilities, the person activation, the activation module, the app test helpers and a test', async () => {
    const found = await violations({
      ...activationFiles,
      'apps/uw-app/commands/capabilities.ts': "import './person/persona-activation.ts';",
      [appActivation]: "import '@uw/harness/persona-activation';",
      'packages/harness/persona-activation.ts': "import './personas/commands.ts';",
      'packages/harness/personas/commands.ts': "import './activate.ts';",
      'packages/harness/personas/activate.ts': "import './flip.ts';",
      'apps/uw-app/testing/kernel.ts': "import '@uw/harness/persona-activation';",
      'apps/uw-app/harness/a.pg.test.ts': "import '@uw/harness/persona-activation';",
    });
    expect(found).toEqual([]);
  });
});

describe('the person gate kernel and the person surface', () => {
  it.each(surfaceRefusals)('refuse %s', async (_name, path, source, rule) => {
    const found = await violations({ ...personSurface, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('allow the command capabilities on the gate kernel, the person deps on the gate GitHub, the command API and tests', async () => {
    const found = await violations({
      ...personSurface,
      'apps/uw-app/commands/capabilities.ts': "import './person/gate-kernel.ts';",
      'apps/uw-app/commands/person/gates.ts': "import './x.ts';",
      'apps/uw-app/commands/person-deps.ts': "import './person/gate-github.ts';",
      'apps/uw-app/commands/routes.ts': "import './person/x.ts'; import './person-deps.ts';",
      'apps/uw-app/commands/person/gate-kernel.test.ts': "import './gate-kernel.ts';",
      'apps/uw-app/testing/commands.ts':
        "import '../commands/person/x.ts'; import '../commands/person-deps.ts';",
      'apps/uw-app/app.tsx': "import './commands/person-deps.ts';",
      'apps/uw-app/cron/request-retention.ts': "import '../commands/requests.ts';",
    });
    expect(found).toEqual([]);
  });

  it('allow the gate kernel on the read client, and the gate GitHub on the transport and the App configuration', async () => {
    const found = await violations({
      [gateKernelFile]: "import '../../github/client.ts';",
      [gateGitHubFile]: "import '../../github/transport.ts'; import '../../github/app-config.ts';",
      'apps/uw-app/kernel.ts': "import './github/refresh.ts';",
      'apps/uw-app/github/refresh.ts': leaf,
    });
    expect(found).toEqual([]);
  });
});
