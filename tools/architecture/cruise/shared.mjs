export const npm = (name) => `(^|node_modules/)${name}(/|$)`;
export const vendorSdk = [
  npm('@anthropic-ai'),
  npm('openai'),
  npm('@openrouter'),
  '(^|node_modules/)openrouter',
];
export const impure = [
  npm('hono'),
  npm('drizzle-orm'),
  npm('wrangler'),
  npm('@cloudflare'),
  '^cloudflare:',
  npm('@neondatabase'),
  npm('pg'),
  npm('postgres'),
  '^(node:)?(http|https|http2|net|tls|dns|dgram)$',
];

export const harnessMayImport = ['^packages/(harness|contracts|core)/', npm('yaml')];
export const contractsMayImport = ['^packages/contracts/', npm('zod')];
export const testFile = '\\.test\\.ts$';
export const portContracts = '^packages/harness/port-contracts/';
export const simMayImport = [
  '^sim/',
  '^packages/(harness|contracts|db)/',
  '^(node:)?(fs|fs/promises|path|url|process|os|assert|assert/strict|child_process)$',
];

export const github = (file) => `^apps/uw-app/github/${file}\\.ts$`;
export const octokitWebhookSignatures = npm('@octokit/webhooks-methods');
export const appTesting = '^apps/(uw-app|uw-ingest)/(github/)?testing/';
export const gateKernel = '^apps/uw-app/commands/person/gate-kernel\\.ts$';
export const gateGitHub = '^apps/uw-app/commands/person/gate-github\\.ts$';
export const commandCapabilities = '^apps/uw-app/commands/capabilities\\.ts$';
export const runHostDeps = '^apps/uw-app/runs/deps\\.ts$';
export const delegatedExitJob = '^apps/uw-app/cron/delegated-exits\\.ts$';
export const readRoots = [
  '^apps/uw-app/queue/worker\\.ts$',
  gateKernel,
  gateGitHub,
  runHostDeps,
  delegatedExitJob,
];
export const appConfigRoots = [
  '^apps/uw-app/(queue/worker|cron/github-sweep|cron/delegated-exits)\\.ts$',
  gateGitHub,
  runHostDeps,
];

export const engineKeys =
  '(claude-messages|openrouter-messages|claude-code-sandbox|codex-sandbox|claude-managed-agent|external)';
export const engineDirectory = `^apps/uw-app/engines/${engineKeys}/`;

export const forbidden = (name, comment, from, to) => ({
  name,
  comment,
  severity: 'error',
  from: { path: from },
  to: { path: to },
});
