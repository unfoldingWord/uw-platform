import type { Bindings } from '../env.ts';

export type GitHubAppConfig = {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKey: string;
};

export function githubAppOf(env: Bindings): GitHubAppConfig | null {
  const appId = env.GITHUB_APP_ID ?? '';
  const installationId = env.GITHUB_APP_INSTALLATION_ID ?? '';
  const privateKey = env.GITHUB_APP_PRIVATE_KEY ?? '';
  if (appId === '' || installationId === '' || privateKey === '') return null;
  return { appId, installationId, privateKey };
}
