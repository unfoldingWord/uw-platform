import { afterEach, describe, expect, it } from 'vitest';
import { leaf, removePlanted, violations } from './planted-cruise.ts';

afterEach(removePlanted);

const signer = {
  'node_modules/aws4fetch/index.js': 'export default 1;',
  'node_modules/aws4fetch/package.json': JSON.stringify({ name: 'aws4fetch', main: 'index.js' }),
};
const client = { 'apps/uw-app/credentials/kms/aws.ts': "import 'aws4fetch';" };

async function rules(files: Record<string, string>): Promise<string[]> {
  return (await violations({ ...signer, ...files })).map((violation) => violation.rule);
}

describe('#157 the AWS signer and the KMS client stay inside the credentials store', () => {
  it('lets the KMS client import the signer, and the store import the client', async () => {
    const found = await rules({
      ...client,
      'apps/uw-app/credentials/store.ts': "import './kms/aws.ts';",
      'apps/uw-app/credentials/kms/aws.test.ts': "import 'aws4fetch'; import './aws.ts';",
    });
    expect(found).toEqual([]);
  });

  it.each([
    ['the store itself', 'apps/uw-app/credentials/store.ts'],
    ['a connector', 'apps/uw-app/ports/connectors.ts'],
    ['an MCP verb', 'apps/uw-app/mcp/verbs/x.ts'],
    ['the kernel', 'packages/harness/x.ts'],
  ])('refuses the signer in %s', async (_name, path) => {
    expect(await rules({ [path]: "import 'aws4fetch';" })).toContain(
      'aws-signer-only-in-the-kms-client',
    );
  });

  it.each([
    ['a connector', 'apps/uw-app/ports/connectors.ts', '../credentials/kms/aws.ts'],
    ['an MCP verb', 'apps/uw-app/mcp/verbs/x.ts', '../../credentials/kms/aws.ts'],
    ['a route', 'apps/uw-app/x.ts', './credentials/kms/aws.ts'],
  ])('refuses the KMS client in %s', async (_name, path, specifier) => {
    const found = await rules({ ...client, [path]: `import '${specifier}'; ${leaf}` });
    expect(found).toContain('kms-client-only-in-the-credentials-store');
  });
});

const store = 'apps/uw-app/credentials';

function openedInside(): void {
  it('lets the store open a value and the connectors adapter use one', async () => {
    const found = await rules({
      [`${store}/open.ts`]: leaf,
      [`${store}/envelope.ts`]: leaf,
      [`${store}/outcome-guard.ts`]: leaf,
      [`${store}/secret.ts`]: leaf,
      [`${store}/use.ts`]: "import './open.ts'; import './secret.ts'; import './outcome-guard.ts';",
      [`${store}/use.pg.test.ts`]: "import './use.ts'; import './secret.ts';",
      'apps/uw-app/ports/connectors.ts':
        "import '../credentials/use.ts'; import '../credentials/secret.ts';",
    });
    expect(found).toEqual([]);
  });

  it.each([
    ['open.ts', 'a connector', 'apps/uw-app/ports/connectors.ts', '../credentials'],
    ['envelope.ts', 'a connector', 'apps/uw-app/ports/connectors.ts', '../credentials'],
    ['outcome-guard.ts', 'a connector', 'apps/uw-app/ports/connectors.ts', '../credentials'],
    ['open.ts', 'a command', 'apps/uw-app/commands/x.ts', '../credentials'],
    ['open.ts', 'a screen', 'apps/uw-app/views/screens/x.tsx', '../../credentials'],
    ['open.ts', 'a cron job', 'apps/uw-app/cron/x.ts', '../credentials'],
  ])('refuses %s in %s', async (file, _name, path, folder) => {
    const found = await rules({
      [`${store}/${file}`]: leaf,
      [path]: `import '${folder}/${file}'; ${leaf}`,
    });
    expect(found).toContain('credential-value-opened-only-inside-the-store');
  });
}

function usedByConnectors(): void {
  it.each([
    ['use.ts', 'a command', 'apps/uw-app/commands/x.ts', '../credentials'],
    ['secret.ts', 'a command', 'apps/uw-app/commands/x.ts', '../credentials'],
    ['secret.ts', 'a screen', 'apps/uw-app/views/screens/x.tsx', '../../credentials'],
    ['use.ts', 'the queue worker', 'apps/uw-app/queue/x.ts', '../credentials'],
    ['secret.ts', 'the logger', 'apps/uw-app/request-logger.ts', './credentials'],
    ['secret.ts', 'the kernel', 'packages/harness/x.ts', '../../apps/uw-app/credentials'],
  ])('refuses %s in %s', async (file, _name, path, folder) => {
    const found = await rules({
      [`${store}/${file}`]: leaf,
      [path]: `import '${folder}/${file}'; ${leaf}`,
    });
    expect(found).toContain('credential-used-only-by-a-connector');
  });
}

function keptFromAgents(): void {
  it.each([
    ['an MCP verb', 'apps/uw-app/mcp/verbs/x.ts', '../../credentials'],
    ['the MCP server', 'apps/uw-app/mcp/x.ts', '../credentials'],
    ['an engine', 'apps/uw-app/engines/external/x.ts', '../../credentials'],
    ['the run host', 'apps/uw-app/runs/x.ts', '../credentials'],
    ['the agents module', 'apps/uw-app/agents/x.ts', '../credentials'],
  ])('refuses every file of the store in %s', async (_name, path, folder) => {
    for (const file of [
      'use.ts',
      'secret.ts',
      'open.ts',
      'store.ts',
      'bindings.ts',
      'compose.ts',
    ]) {
      const found = await rules({
        [`${store}/${file}`]: leaf,
        [path]: `import '${folder}/${file}'; ${leaf}`,
      });
      expect(found).toContain('no-credential-store-on-the-agent-surface');
    }
  });
}

describe('#158 a credential value is opened inside the store and used only by a connector', () => {
  describe('a sealed value is opened only inside the store', openedInside);
  describe('a credential is used only by the connectors adapter', usedByConnectors);
  describe('the agent surface imports nothing of the store', keptFromAgents);
});
