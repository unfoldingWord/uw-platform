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
