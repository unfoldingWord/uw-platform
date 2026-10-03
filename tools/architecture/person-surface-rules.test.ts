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
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a gate command opening the gate GitHub',
    'apps/uw-app/commands/person/gates.ts',
    "import { platformGateGitHub } from './gate-github.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the command capabilities opening the gate GitHub',
    'apps/uw-app/commands/capabilities.ts',
    "import './person/gate-github.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the dispatcher building the gate kernel',
    'apps/uw-app/commands/dispatch.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the person deps building the gate kernel',
    'apps/uw-app/commands/person-deps.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'another person command opening the gate GitHub',
    'apps/uw-app/commands/person/stages.ts',
    "import './gate-github.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the MCP routes building the gate kernel',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
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
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a type-only import of the gate kernel from another person command',
    'apps/uw-app/commands/person/stages.ts',
    "import type { gateKernel } from './gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a dynamic import of the gate GitHub from the dispatcher',
    'apps/uw-app/commands/dispatch.ts',
    "export const opener = () => import('./person/gate-github.ts');",
    'gate-kernel-only-in-gate-commands',
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
    'agent-hosts-never-import-commands',
  ],
  [
    'the cron reaching the dispatcher',
    'apps/uw-app/cron/request-retention.ts',
    "import '../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'the queue reaching the request ledger',
    'apps/uw-app/queue/worker.ts',
    "import '../commands/requests.ts';",
    'agent-hosts-never-import-commands',
  ],
];

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
