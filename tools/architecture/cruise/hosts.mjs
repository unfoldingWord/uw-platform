import {
  testFile,
  appTesting,
  gateKernel,
  gateGitHub,
  commandCapabilities,
  forbidden,
} from './shared.mjs';

const personActivation = '^apps/uw-app/commands/person/persona-activation\\.ts$';

export const hostRules = [
  {
    name: 'in-process-host-only-in-run-steps',
    comment:
      'Only the run steps (and tests) connect the in-process Workflow host, so every step connects as its run scene and nothing else picks a principal for it.',
    severity: 'error',
    from: { pathNot: [testFile, '^apps/uw-app/runs/steps\\.ts$'] },
    to: { path: '^apps/uw-app/mcp/in-process\\.ts$' },
  },
  {
    name: 'run-host-only-from-the-workflow',
    comment:
      'The run host under apps/uw-app/runs/ is reached only from the Worker entry, which exports the HarnessRun Workflow, from itself, and from tests and their helpers.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/index\\.ts$', '^apps/uw-app/runs/', appTesting, testFile] },
    to: { path: '^apps/uw-app/runs/' },
  },
  forbidden(
    'mcp-never-imports-the-run-host',
    'The MCP surface imports nothing of the run host, so no verb reaches the run kernel or its GitHub wiring.',
    '^apps/uw-app/mcp/',
    '^apps/uw-app/runs/',
  ),
  {
    name: 'verb-server-only-in-the-hosts',
    comment:
      'The verb server is built only by the HTTP route and the in-process host (and the test helpers), so no third site serves verbs under a principal of its choosing.',
    severity: 'error',
    from: {
      pathNot: [
        '^apps/uw-app/mcp/(routes|in-process|server)\\.ts$',
        '^apps/uw-app/testing/',
        testFile,
      ],
    },
    to: { path: '^apps/uw-app/mcp/server\\.ts$' },
  },
  {
    name: 'app-testing-only-in-tests',
    comment:
      'The app test helpers under testing/ write fixtures straight into tables and hold fixture keys, so only test files and other test helpers import them.',
    severity: 'error',
    from: { pathNot: [testFile, appTesting] },
    to: { path: appTesting },
  },
  {
    name: 'harness-testing-only-in-tests',
    comment:
      'The connector exit and other test-only kernel entry points are imported only by test files.',
    severity: 'error',
    from: { pathNot: testFile },
    to: { path: '^packages/harness/testing\\.ts$' },
  },
  {
    name: 'gate-kernel-only-in-capabilities',
    comment:
      'Only the command capabilities build the kernel that holds the GitHub reader and the ship writes, and they hand it only to a person on a gate command.',
    severity: 'error',
    from: { pathNot: [commandCapabilities, testFile] },
    to: { path: gateKernel },
  },
  {
    name: 'persona-activation-only-in-the-person-surface',
    comment:
      'Only an admin makes a persona active, so the kernel and its package index carry no activation: the activation module is built only by the person activation, the app test helpers, the simulator and tests (S10-R18).',
    severity: 'error',
    from: {
      pathNot: [
        personActivation,
        '^packages/harness/persona-activation\\.ts$',
        '^packages/harness/personas/(commands|activate)\\.ts$',
        appTesting,
        '^sim/',
        testFile,
      ],
    },
    to: { path: '^packages/harness/(persona-activation|personas/(commands|activate|flip))\\.ts$' },
  },
  {
    name: 'persona-activation-only-in-capabilities',
    comment:
      'Only the command capabilities build the persona activation, and they build it only for the activate_persona command, which refuses an agent.',
    severity: 'error',
    from: { pathNot: [commandCapabilities, testFile] },
    to: { path: personActivation },
  },
  {
    name: 'gate-github-only-in-person-deps',
    comment: 'Only the person deps open the gate GitHub, for the gate commands.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/commands/person-deps\\.ts$', testFile] },
    to: { path: gateGitHub },
  },
  {
    name: 'person-deps-only-in-app-and-routes',
    comment:
      'The person deps hold the gate GitHub opener, so only the app, the command routes, the app test helpers and tests import them.',
    severity: 'error',
    from: {
      pathNot: [
        '^apps/uw-app/app\\.tsx$',
        '^apps/uw-app/commands/routes\\.ts$',
        appTesting,
        testFile,
      ],
    },
    to: { path: '^apps/uw-app/commands/person-deps\\.ts$' },
  },
  {
    name: 'person-surface-only-from-commands',
    comment:
      'The person surface is imported only from apps/uw-app/commands/, the app test helpers and tests.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/commands/', appTesting, testFile] },
    to: { path: '^apps/uw-app/commands/person/' },
  },
  forbidden(
    'agent-hosts-never-import-commands',
    'Nothing an agent, a model process or the queue reaches imports the command API, so none of them reaches the gate kernel.',
    '^apps/uw-app/(mcp|engines|queue)/',
    '^apps/uw-app/commands/',
  ),
  {
    name: 'confirm-page-only-from-page-routes',
    comment:
      'Confirmation turns a learning or a skill active, which only a person does, so only the page routes and tests import it and no agent host reaches it.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/pages/routes\\.ts$', testFile] },
    to: { path: '^apps/uw-app/pages/confirm\\.ts$' },
  },
  {
    name: 'cron-imports-only-the-request-ledger',
    comment:
      'The cron imports nothing of the command API but the request ledger, whose old rows it prunes, so it never reaches the gate kernel.',
    severity: 'error',
    from: { path: '^apps/uw-app/cron/' },
    to: { path: '^apps/uw-app/commands/', pathNot: '^apps/uw-app/commands/requests\\.ts$' },
  },
];
