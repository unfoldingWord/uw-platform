import { describe, expect, it } from 'vitest';
import { githubEgress, GITHUB_API_HOST, GITHUB_HOST, type GitHubRoute } from './github-egress.ts';

const repository = 'unfoldingWord/uw-platform';
const branch = 'harness/00000000-0000-4000-8000-0000000000b1';
const zero = '0'.repeat(40);
const old = 'a'.repeat(40);
const next = 'b'.repeat(40);
const TOKEN = 'ghs_builder_installation_token';
const declaration =
  '```harness\ncloses: #12\nrisks: none\ntouches: apps/uw-app/board\nrisk_tier: standard\nrisk_domains: none\n```\n\nAdds the board.';

type Sent = {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
};

type Rig = {
  readonly sent: Sent[];
  readonly refused: string[];
  readonly unwired: string[];
  readonly admitted: number[];
  readonly route: GitHubRoute;
  readonly fetcher: typeof fetch;
};

function rig(options: { readonly token?: string | null; readonly admit?: boolean } = {}): Rig {
  const sent: Sent[] = [];
  const refused: string[] = [];
  const unwired: string[] = [];
  const admitted: number[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = request.body === null ? '' : await request.text();
    sent.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return new Response('upstream', { status: 200 });
  };
  const token = options.token === undefined ? TOKEN : options.token;
  const route: GitHubRoute = {
    github: {
      repository,
      branch,
      defaultBranch: 'main',
      token: async () => token,
      unwired: (host, path) => void unwired.push(`${host}${path}`),
    },
    admit: async () => {
      admitted.push(1);
      return options.admit ?? true;
    },
    refused: (host, path) => void refused.push(`${host}${path}`),
  };
  return { sent, refused, unwired, admitted, route, fetcher };
}

function pkt(text: string): string {
  return (text.length + 4).toString(16).padStart(4, '0') + text;
}

function push(...updates: readonly string[]): Request {
  const body = [
    ...updates.map((update, n) => pkt(n === 0 ? `${update}\0report-status\n` : `${update}\n`)),
    '0000',
    'PACK',
  ].join('');
  return new Request(`http://${GITHUB_HOST}/${repository}.git/git-receive-pack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      authorization: 'Basic c2FuZGJveDpzZWNyZXQ=',
      cookie: 'session=1',
      'x-api-key': 'sandbox',
      'proxy-authorization': 'Basic x',
      'cf-aig-authorization': 'Bearer forged',
      'x-forwarded-for': '10.0.0.1',
      'user-agent': 'git/2.47',
    },
    body,
  });
}

function pulls(body: Record<string, unknown>, path = `/repos/${repository}/pulls`): Request {
  return new Request(`http://${GITHUB_API_HOST}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sandbox' },
    body: JSON.stringify(body),
  });
}

const opened = { title: 'Add the board', head: branch, base: 'main', body: declaration };

async function statusOf(r: Rig, request: Request): Promise<number | null> {
  const response = await githubEgress(request, r.route, r.fetcher);
  return response?.status ?? null;
}

async function pushForwarded(): Promise<void> {
  const r = rig();
  expect(await statusOf(r, push(`${old} ${next} refs/heads/${branch}`))).toBe(200);
  const [forwarded] = r.sent;
  expect(forwarded?.url).toBe(`https://github.com/${repository}.git/git-receive-pack`);
  const basic = `Basic ${btoa(`x-access-token:${TOKEN}`)}`;
  expect(forwarded?.headers).toEqual({
    authorization: basic,
    'content-type': 'application/x-git-receive-pack-request',
    'user-agent': 'git/2.47',
  });
  expect(forwarded?.body).toContain(`refs/heads/${branch}`);
  const advert = new Request(
    `http://${GITHUB_HOST}/${repository.toLowerCase()}.git/info/refs?service=git-receive-pack`,
    { headers: { 'git-protocol': 'version=2' } },
  );
  expect(await statusOf(r, advert)).toBe(200);
  expect(r.sent[1]?.headers['git-protocol']).toBeUndefined();
  expect(r.admitted).toHaveLength(2);
}

async function pushRefused(): Promise<void> {
  const r = rig();
  const attempts = [
    push(`${old} ${next} refs/heads/main`),
    push(`${old} ${next} refs/heads/${branch}`, `${old} ${next} refs/heads/main`),
    push(`${old} ${next} refs/heads/${branch}`, `${old} ${next} refs/heads/${branch}`),
    push(`${old} ${zero} refs/heads/${branch}`),
    push(`${old} ${next} refs/tags/${branch}`),
    new Request(`http://${GITHUB_HOST}/${repository}.git/git-receive-pack`, {
      method: 'POST',
      body: 'not a pkt-line',
    }),
  ];
  for (const attempt of attempts) expect(await statusOf(r, attempt)).toBe(403);
  expect(r.sent).toEqual([]);
  expect(r.admitted).toEqual([]);
  expect(r.refused).toHaveLength(attempts.length);
}

async function pullRequestOpened(): Promise<void> {
  const r = rig();
  expect(await statusOf(r, pulls(opened))).toBe(200);
  expect(await statusOf(r, pulls({ ...opened, head: `unfoldingWord:${branch}` }))).toBe(200);
  expect(r.sent[0]?.url).toBe(`https://api.github.com/repos/${repository}/pulls`);
  expect(r.sent[0]?.headers).toMatchObject({
    authorization: `Bearer ${TOKEN}`,
    'x-github-api-version': '2022-11-28',
  });
  const refused = [
    { ...opened, head: 'harness/other' },
    { ...opened, base: 'release' },
    { ...opened, body: 'No declaration.' },
    { ...opened, issue: 12 },
    { ...opened, maintainer_can_modify: true },
    { title: 'Add the board', head: branch, base: 'main' },
  ];
  for (const body of refused) expect(await statusOf(r, pulls(body))).toBe(403);
  const listed = new Request(
    `http://${GITHUB_API_HOST}/repos/${repository}/pulls?head=unfoldingWord:${branch}&state=open`,
  );
  expect(await statusOf(r, listed)).toBe(200);
  const anyHead = new Request(`http://${GITHUB_API_HOST}/repos/${repository}/pulls?state=all`);
  expect(await statusOf(r, anyHead)).toBe(403);
  expect(r.sent).toHaveLength(3);
}

async function otherRefused(): Promise<void> {
  const r = rig();
  const other = 'unfoldingWord/other';
  const attempts = [
    new Request(`http://${GITHUB_HOST}/${other}.git/info/refs?service=git-upload-pack`),
    new Request(`http://${GITHUB_HOST}/${repository}.git/info/refs?service=git-upload-pack&x=1`),
    new Request(`http://${GITHUB_HOST}/${repository}/archive/main.zip`),
    new Request(`http://${GITHUB_API_HOST}/repos/${repository}/issues`, {
      method: 'POST',
      body: '{}',
    }),
    new Request(`http://${GITHUB_API_HOST}/repos/${repository}/pulls/1`, {
      method: 'PATCH',
      body: '{}',
    }),
    new Request(`http://${GITHUB_API_HOST}/repos/${repository}/merges`, {
      method: 'POST',
      body: '{}',
    }),
    pulls(opened, `/repos/${other}/pulls`),
    new Request(`http://${GITHUB_API_HOST}/user`),
  ];
  for (const attempt of attempts) expect(await statusOf(r, attempt)).toBe(403);
  expect(r.sent).toEqual([]);
  const fetchOk = new Request(
    `http://${GITHUB_HOST}/${repository}.git/info/refs?service=git-upload-pack`,
  );
  expect(await statusOf(r, fetchOk)).toBe(200);
  const upload = new Request(`http://${GITHUB_HOST}/${repository}.git/git-upload-pack`, {
    method: 'POST',
    headers: {
      'git-protocol': 'version=2',
      'content-type': 'application/x-git-upload-pack-request',
    },
    body: '0000',
  });
  expect(await statusOf(r, upload)).toBe(200);
  expect(r.sent[1]?.headers['git-protocol']).toBe('version=2');
  expect(await statusOf(r, new Request('http://example.org/'))).toBeNull();
}

async function credentialsDropped(): Promise<void> {
  const halted = rig({ admit: false });
  expect(await statusOf(halted, push(`${old} ${next} refs/heads/${branch}`))).toBe(403);
  expect(halted.sent).toEqual([]);
  const unwired = rig({ token: null });
  const response = await githubEgress(pulls(opened), unwired.route, unwired.fetcher);
  expect([response?.status, await response?.text()]).toEqual([503, 'egress not configured']);
  expect(unwired.unwired).toEqual([`${GITHUB_API_HOST}/repos/${repository}/pulls`]);
  const r = rig();
  const answered = await githubEgress(pulls(opened), r.route, r.fetcher);
  expect(await answered?.text()).not.toContain(TOKEN);
  const reviewRun = { ...r.route, github: null };
  expect(await statusOf({ ...r, route: reviewRun }, pulls(opened))).toBe(403);
  expect(JSON.stringify(r.refused)).not.toContain(TOKEN);
}

describe('the GitHub egress for a hosted Builder', () => {
  it('PE-5 a push to harness/<item> is forwarded with the Builder token injected', pushForwarded);
  it('PE-5 a push naming another ref, a second ref or a delete is refused', pushRefused);
  it(
    'PE-5 a pull request is opened only from harness/<item> into the default branch with a parseable harness declaration',
    pullRequestOpened,
  );
  it('PE-5 another repository and any other GitHub path are refused', otherRefused);
  it(
    "PE-5 the sandbox's own credentials are dropped and the token never reaches the sandbox",
    credentialsDropped,
  );
});
