import { createPrivateKey, createSign } from 'node:crypto';
import { ORG, targetFor, type DeployEnv, type GitHubAppTarget } from './apps.ts';

type Worker = 'uw-app' | 'uw-ingest';

export type SecretWrite = {
  readonly worker: Worker;
  readonly env: DeployEnv;
  readonly name: string;
  readonly value: string;
};

export type ConvertDeps = {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly putSecret: (write: SecretWrite) => Promise<void>;
  readonly nowSeconds: () => number;
  readonly log: (line: string) => void;
};

type Conversion = {
  readonly id: number;
  readonly slug: string;
  readonly pem: string;
  readonly webhook_secret: string | null;
};

const API = 'https://api.github.com';
const CODE = /^[A-Za-z0-9_-]{8,128}$/;

function conversionOf(body: unknown): Conversion {
  const value = body as Partial<Conversion> | null;
  if (
    value === null ||
    typeof value.id !== 'number' ||
    typeof value.slug !== 'string' ||
    typeof value.pem !== 'string'
  ) {
    throw new Error('GitHub did not return an App conversion');
  }
  return {
    id: value.id,
    slug: value.slug,
    pem: value.pem,
    webhook_secret: typeof value.webhook_secret === 'string' ? value.webhook_secret : null,
  };
}

export function pkcs8Of(pem: string): string {
  return createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem' }).toString();
}

function base64url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

export function appJwt(appId: number, pem: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: String(appId) }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(pem, 'base64url')}`;
}

async function installationOf(
  deps: ConvertDeps,
  conversion: Conversion,
  pem: string,
): Promise<number | null> {
  const response = await deps.fetch(`${API}/app/installations`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${appJwt(conversion.id, pem, deps.nowSeconds())}`,
      'user-agent': 'uw-platform-setup',
    },
  });
  if (!response.ok) return null;
  const list = (await response.json()) as readonly {
    id?: unknown;
    account?: { login?: unknown };
  }[];
  const match = list.find((entry) => entry.account?.login === ORG);
  return typeof match?.id === 'number' ? match.id : null;
}

async function exchange(code: string, deps: ConvertDeps): Promise<Conversion> {
  if (!CODE.test(code)) throw new Error('That does not look like a manifest code');
  const response = await deps.fetch(`${API}/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'uw-platform-setup' },
  });
  if (!response.ok) {
    throw new Error(`GitHub refused the code (${response.status}); it works once, within an hour`);
  }
  return conversionOf(await response.json());
}

function ourTarget(conversion: Conversion): GitHubAppTarget {
  const target = targetFor(conversion.slug);
  if (target === null) {
    throw new Error(
      `GitHub registered the App as ${conversion.slug}, which is not one of ours; rename it and register again`,
    );
  }
  if (target.webhook && conversion.webhook_secret === null) {
    throw new Error(`${conversion.slug} came back without a webhook secret`);
  }
  return target;
}

type Value = readonly [Worker, string, string | null];

function valuesOf(
  target: GitHubAppTarget,
  conversion: Conversion,
  pem: string,
  installation: number | null,
): readonly Value[] {
  return [
    ['uw-app', `${target.prefix}_ID`, String(conversion.id)],
    ['uw-app', `${target.prefix}_PRIVATE_KEY`, pem],
    [
      'uw-app',
      `${target.prefix}_INSTALLATION_ID`,
      installation === null ? null : String(installation),
    ],
    ['uw-ingest', 'GITHUB_WEBHOOK_SECRET', target.webhook ? conversion.webhook_secret : null],
  ];
}

export async function convertApp(code: string, deps: ConvertDeps): Promise<void> {
  const conversion = await exchange(code, deps);
  const target = ourTarget(conversion);
  const pem = pkcs8Of(conversion.pem);
  const installation = await installationOf(deps, conversion, pem);
  const values = valuesOf(target, conversion, pem, installation);
  deps.log(`App ${conversion.slug} (id ${conversion.id})`);
  for (const env of target.envs) {
    for (const [worker, name, value] of values) {
      if (value === null) continue;
      await deps.putSecret({ worker, env, name, value });
      deps.log(`  set ${name} on ${worker} ${env}`);
    }
  }
  if (installation === null) {
    deps.log(
      `  ${conversion.slug} is not installed on ${ORG} yet. Install it on uw-platform, then set ${target.prefix}_INSTALLATION_ID by hand with the id from the installation's settings address.`,
    );
  }
}
