import { afterEach, describe, expect, it } from 'vitest';
import { leaf, removePlanted, store, violations } from './planted-cruise.ts';

afterEach(removePlanted);

const refusals: [string, string, string, string][] = [
  [
    'the cron sweep root reaching the read client',
    'apps/uw-platform/cron/github-sweep.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'the scheduled root reaching the App configuration',
    'apps/uw-platform/cron/scheduled.ts',
    "import '../github/app-config.ts';",
    'github-app-config-only-in-github-and-composition-roots',
  ],
  [
    'the kernel root reaching the transport',
    'apps/uw-platform/kernel.ts',
    "import './github/transport.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'a route reaching the read client',
    'apps/uw-platform/http/a.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'a port adapter reaching the read client',
    'apps/uw-platform/ports/connectors.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'any other Octokit package outside the session',
    'apps/uw-platform/x.ts',
    "import '@octokit/rest';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the webhook signature package outside uw-ingest',
    'apps/uw-platform/x.ts',
    "import '@octokit/webhooks-methods';",
    'octokit-webhooks-methods-only-in-ingest',
  ],
  [
    'a route opening a session',
    'apps/uw-platform/http/a.ts',
    "import '../github/session.ts';",
    'github-session-only-in-the-github-clients',
  ],
  [
    'the read client minting a token itself',
    'apps/uw-platform/github/client.ts',
    "import './token.ts';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the kernel root reaching Octokit',
    'apps/uw-platform/kernel.ts',
    "import '@octokit/core';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the queue root taking the Reviewer review writes',
    'apps/uw-platform/queue/worker.ts',
    "import '../github/review-writes.ts';",
    'review-writes-only-in-the-connectors-adapter',
  ],
  [
    'the MCP surface taking the Reviewer review writes',
    'apps/uw-platform/mcp/server.ts',
    "import '../github/review-writes.ts';",
    'review-writes-only-in-the-connectors-adapter',
  ],
  [
    'the kernel root reading the Reviewer App configuration',
    'apps/uw-platform/kernel.ts',
    "import './github/reviewer-apps.ts';",
    'reviewer-apps-only-in-the-run-host',
  ],
  [
    'the kernel root reading the Builder App',
    'apps/uw-platform/kernel.ts',
    "import './github/builder-app.ts';",
    'builder-app-only-in-the-run-host',
  ],
  [
    'a run body minting the Builder token itself',
    'apps/uw-platform/runs/bodies.ts',
    "import '../github/builder-app.ts';",
    'builder-app-only-in-the-run-host',
  ],
  [
    'the sandbox egress reaching the Builder App',
    'apps/uw-platform/engines/sandbox/github-egress.ts',
    "import '../../github/builder-app.ts';",
    'builder-app-only-in-the-run-host',
  ],
  [
    'the queue root taking the merge and tag writes',
    'apps/uw-platform/queue/worker.ts',
    "import '../github/ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'the cron root taking the merge and tag writes',
    'apps/uw-platform/cron/scheduled.ts',
    "import '../github/ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'another GitHub module taking the merge and tag writes',
    'apps/uw-platform/github/import.ts',
    "import './ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'the queue root building the merge connector',
    'apps/uw-platform/queue/worker.ts',
    "import '../github/merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
  ],
  [
    'the kernel root building the merge connector itself',
    'apps/uw-platform/kernel.ts',
    "import './github/merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
  ],
  [
    'another GitHub module building the merge connector',
    'apps/uw-platform/github/sweep.ts',
    "import './merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
  ],
  [
    'the queue root taking the comment writer',
    'apps/uw-platform/queue/worker.ts',
    "import '../github/comments.ts';",
    'github-comments-only-in-github',
  ],
  [
    'an MCP test reaching the transport',
    'apps/uw-platform/mcp/a.test.ts',
    "import '../github/transport.ts';",
    'github-never-in-mcp-or-engines',
  ],
  [
    'an engine reaching the read client',
    'apps/uw-platform/engines/e/a.ts',
    "import '../../github/client.ts';",
    'github-never-in-mcp-or-engines',
  ],
];

const moduleRefusals: [string, string, string][] = [
  [
    'a route reaching the read client factory',
    'apps/uw-platform/http/a.ts',
    "import '../github/deps.ts';",
  ],
  ['a route reaching the sweep', 'apps/uw-platform/http/a.ts', "import '../github/sweep.ts';"],
  [
    'a page module reaching the import',
    'apps/uw-platform/pages/a.ts',
    "import '../github/import.ts';",
  ],
  [
    'the scheduled root reaching the sweep',
    'apps/uw-platform/cron/scheduled.ts',
    "import '../github/sweep.ts';",
  ],
];

describe('the GitHub module is imported only by the platform adapters and the queue and cron roots', () => {
  it.each(moduleRefusals)('refuses %s', async (_name, path, source) => {
    const found = await violations({
      'apps/uw-platform/github/deps.ts': leaf,
      'apps/uw-platform/github/sweep.ts': leaf,
      'apps/uw-platform/github/import.ts': leaf,
      [path]: source,
    });
    expect(found.map((violation) => violation.rule)).toContain(
      'github-module-only-in-ports-and-roots',
    );
  });

  it('allows the adapters, the queue and cron sweep roots, the module itself and tests', async () => {
    const found = await violations({
      'apps/uw-platform/github/deps.ts': leaf,
      'apps/uw-platform/github/sweep.ts': "import './deps.ts';",
      'apps/uw-platform/ports/github-facts.ts': "import '../github/sweep.ts';",
      'apps/uw-platform/queue/worker.ts': "import '../github/deps.ts';",
      'apps/uw-platform/cron/github-sweep.ts': "import '../github/sweep.ts';",
      'apps/uw-platform/http/a.test.ts': "import '../github/deps.ts';",
    });
    expect(found.map((violation) => violation.rule)).not.toContain(
      'github-module-only-in-ports-and-roots',
    );
  });
});

const importCommandFile = 'apps/uw-platform/commands/capabilities.ts';
const importPath = {
  'apps/uw-platform/github/import.ts': leaf,
  'apps/uw-platform/github/facts/queries.ts': leaf,
  'apps/uw-platform/github/cross-reference.ts': leaf,
  'apps/uw-platform/github/sweep.ts': leaf,
};

const importCommandRefusals: [string, string, string, string][] = [
  [
    'the command capabilities reaching the cross-reference writer',
    importCommandFile,
    "import '../github/cross-reference.ts';",
    'import-command-only-on-the-import-path',
  ],
  [
    'the command capabilities reaching the sweep',
    importCommandFile,
    "import '../github/sweep.ts';",
    'import-command-only-on-the-import-path',
  ],
  [
    'the command capabilities reaching the read client',
    importCommandFile,
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'the import handler reaching the import path itself',
    'apps/uw-platform/commands/handlers/import.ts',
    "import '../../github/import.ts';",
    'github-module-only-in-ports-and-roots',
  ],
  [
    'another command reaching the import path',
    'apps/uw-platform/commands/handlers/items.ts',
    "import '../../github/import.ts';",
    'github-module-only-in-ports-and-roots',
  ],
];

describe('the person import command', () => {
  it.each(importCommandRefusals)('refuses %s', async (_name, path, source, rule) => {
    const found = await violations({ ...importPath, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('allows the command capabilities on the import path and the issue read', async () => {
    const found = await violations({
      ...importPath,
      [importCommandFile]: "import '../github/import.ts'; import '../github/facts/queries.ts';",
    });
    expect(found).toEqual([]);
  });
});

const agentPlaneFile = 'apps/uw-platform/health/agent-plane.ts';

describe('the agent plane', () => {
  it('reads the sweep state through the read model queries', async () => {
    const found = await violations({
      ...importPath,
      [agentPlaneFile]: "import '../github/facts/queries.ts';",
    });
    expect(found).toEqual([]);
  });

  it('refuses any other module under apps/uw-platform/github', async () => {
    const found = await violations({
      ...importPath,
      [agentPlaneFile]: "import '../github/sweep.ts';",
    });
    expect(found.map((violation) => violation.rule)).toEqual([
      'agent-plane-only-on-the-sweep-queries',
    ]);
  });

  it('leaves the rest of health off the GitHub module', async () => {
    const found = await violations({
      ...importPath,
      'apps/uw-platform/health/hub.ts': "import '../github/facts/queries.ts';",
    });
    expect(found.map((violation) => violation.rule)).toContain(
      'github-module-only-in-ports-and-roots',
    );
  });
});

describe('the GitHub dependency rules refuse', () => {
  it.each(refusals)('%s', async (_name, path, source, rule) => {
    const found = await violations({ [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('Octokit outside the session where pnpm resolves it into its store', async () => {
    const found = await violations({ 'apps/uw-platform/x.ts': "import '@octokit/core';" });
    expect(found).toEqual([
      { rule: 'github-token-and-octokit-only-in-the-session', to: `${store}/index.js` },
    ]);
  });
});

describe('the app test helpers', () => {
  it('refuse a module that is not a test', async () => {
    const found = await violations({
      'apps/uw-platform/testing/github-facts.ts': leaf,
      'apps/uw-platform/http/a.ts': "import '../testing/github-facts.ts';",
    });
    expect(found.map((violation) => violation.rule)).toContain('app-testing-only-in-tests');
  });

  it('allow a test file and another test helper', async () => {
    const found = await violations({
      'apps/uw-platform/github/testing/facts-fixtures.ts': leaf,
      'apps/uw-platform/testing/github-facts.ts': "import '../github/testing/facts-fixtures.ts';",
      'apps/uw-platform/mcp/a.test.ts': "import '../testing/github-facts.ts';",
    });
    expect(found.map((violation) => violation.rule)).not.toContain('app-testing-only-in-tests');
  });
});

describe('the GitHub dependency rules allow', () => {
  it('the queue root on the read client, its transport and the App configuration', async () => {
    const reads =
      "import '../github/client.ts'; import '../github/transport.ts'; import '../github/app-config.ts';";
    expect(await violations({ 'apps/uw-platform/queue/worker.ts': reads })).toEqual([]);
  });

  it('the cron sweep root on the App configuration', async () => {
    expect(
      await violations({
        'apps/uw-platform/cron/github-sweep.ts': "import '../github/app-config.ts';",
      }),
    ).toEqual([]);
  });

  it('uw-ingest on the webhook signature package', async () => {
    expect(
      await violations({ 'apps/uw-ingest/sources/a.ts': "import '@octokit/webhooks-methods';" }),
    ).toEqual([]);
  });

  it('the session on the token and Octokit, and the clients on the session', async () => {
    expect(
      await violations({
        'apps/uw-platform/github/session.ts': "import './token.ts'; import '@octokit/core';",
        'apps/uw-platform/github/client.ts': "import './session.ts';",
        'apps/uw-platform/github/comments.ts': "import './session.ts';",
        'apps/uw-platform/github/ship-writes.ts': "import './session.ts';",
        'apps/uw-platform/github/review-writes.ts': "import './session.ts';",
        'apps/uw-platform/github/diff.ts': "import './session.ts';",
      }),
    ).toEqual([]);
  });
});

describe('the Reviewer dependency rules allow', () => {
  it('the connectors adapter on the Reviewer review writes and the run host on the Reviewer Apps', async () => {
    expect(
      await violations({
        'apps/uw-platform/ports/connectors.ts': "import '../github/review-writes.ts';",
        'apps/uw-platform/runs/deps.ts': "import '../github/reviewer-apps.ts';",
      }),
    ).toEqual([]);
  });

  it('the run host on the Builder App, and the Builder App on the token', async () => {
    expect(
      await violations({
        'apps/uw-platform/runs/deps.ts': "import '../github/builder-app.ts';",
        'apps/uw-platform/github/builder-app.ts': "import './token.ts';",
      }),
    ).toEqual([]);
  });

  it('the connectors adapter, a GitHub test helper and a test on the merge connector', async () => {
    expect(
      await violations({
        'apps/uw-platform/ports/connectors.ts': "import '../github/merge.ts';",
        'apps/uw-platform/github/testing/merge-rig.ts': "import '../merge.ts';",
        'apps/uw-platform/github/b.test.ts': "import './merge.ts';",
      }),
    ).toEqual([]);
  });

  it('the merge connector on the ship writes, a GitHub module on the comment writer, and tests', async () => {
    expect(
      await violations({
        'apps/uw-platform/github/merge.ts': "import './ship-writes.ts'; import './client.ts';",
        'apps/uw-platform/github/import.ts': "import './comments.ts'; import './client.ts';",
        'apps/uw-platform/github/a.test.ts': "import './ship-writes.ts'; import './token.ts';",
      }),
    ).toEqual([]);
  });
});
