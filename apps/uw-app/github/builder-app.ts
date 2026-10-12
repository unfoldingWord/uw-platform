import type { Bindings } from '../env.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { installationToken, type TokenScope } from './token.ts';
import type { GitHubTransport } from './transport.ts';

type BuilderEnv = Pick<
  Bindings,
  'BUILDER_GITHUB_APP_ID' | 'BUILDER_GITHUB_APP_INSTALLATION_ID' | 'BUILDER_GITHUB_APP_PRIVATE_KEY'
>;

export type StepToken = () => Promise<string | null>;

const permissions: TokenScope['permissions'] = {
  contents: 'write',
  pull_requests: 'write',
  metadata: 'read',
};
const repositoryName = /^[A-Za-z0-9-]+\/([A-Za-z0-9._-]+)$/;

export function builderAppOf(env: BuilderEnv): GitHubAppConfig | null {
  const appId = env.BUILDER_GITHUB_APP_ID ?? '';
  const installationId = env.BUILDER_GITHUB_APP_INSTALLATION_ID ?? '';
  const privateKey = env.BUILDER_GITHUB_APP_PRIVATE_KEY ?? '';
  if (appId === '' || installationId === '' || privateKey === '') return null;
  return { appId, installationId, privateKey };
}

function nameOf(repository: string): string | null {
  const name = repositoryName.exec(repository)?.[1];
  return name === undefined || /^\.+$/.test(name) ? null : name;
}

async function minted(
  config: GitHubAppConfig,
  transport: GitHubTransport,
  name: string,
): Promise<string | null> {
  const issued = await installationToken(config, transport, { repository: name, permissions });
  return issued.ok ? issued.value.token : null;
}

export function builderTokens(
  config: GitHubAppConfig | null,
  transport: GitHubTransport,
): (repository: string) => StepToken {
  return (repository) => {
    const name = nameOf(repository);
    if (config === null || name === null) return () => Promise.resolve(null);
    let held: Promise<string | null> | null = null;
    return () => {
      held ??= minted(config, transport, name).then((issued) => {
        if (issued === null) held = null;
        return issued;
      });
      return held;
    };
  };
}
