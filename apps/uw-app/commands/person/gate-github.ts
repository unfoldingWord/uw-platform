import type { Bindings } from '../../env.ts';
import { githubAppOf } from '../../github/app-config.ts';
import { platformGitHubTransport } from '../../github/transport.ts';
import type { ShipGitHub } from '../../ports/connectors.ts';

export function platformGateGitHub(env: Bindings, now: () => Date): ShipGitHub | null {
  const app = githubAppOf(env);
  if (app === null) return null;
  return { app, transport: platformGitHubTransport(now) };
}
