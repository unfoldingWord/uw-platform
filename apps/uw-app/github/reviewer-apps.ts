import type { Bindings } from '../env.ts';
import type { GitHubAppConfig } from './app-config.ts';

type Settings = {
  readonly appId: string | undefined;
  readonly installationId: string | undefined;
  readonly privateKey: string | undefined;
};

function configOf(settings: Settings): GitHubAppConfig | null {
  const appId = settings.appId ?? '';
  const installationId = settings.installationId ?? '';
  const privateKey = settings.privateKey ?? '';
  if (appId === '' || installationId === '' || privateKey === '') return null;
  return { appId, installationId, privateKey };
}

export function reviewerAppsOf(env: Bindings): ReadonlyMap<string, GitHubAppConfig> {
  const apps = new Map<string, GitHubAppConfig>();
  const reviewer = configOf({
    appId: env.REVIEWER_GITHUB_APP_ID,
    installationId: env.REVIEWER_GITHUB_APP_INSTALLATION_ID,
    privateKey: env.REVIEWER_GITHUB_APP_PRIVATE_KEY,
  });
  const codex = configOf({
    appId: env.REVIEWER_CODEX_GITHUB_APP_ID,
    installationId: env.REVIEWER_CODEX_GITHUB_APP_INSTALLATION_ID,
    privateKey: env.REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY,
  });
  if (reviewer !== null) apps.set('uw-reviewer', reviewer);
  if (codex !== null) apps.set('uw-reviewer-codex', codex);
  return apps;
}
