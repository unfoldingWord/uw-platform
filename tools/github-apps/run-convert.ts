import { spawn } from 'node:child_process';
import { convertApp, type SecretWrite } from './convert.ts';

function putSecret(write: SecretWrite): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', write.name, '--env', write.env], {
      cwd: `infra/${write.worker}`,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status === 0) resolve();
      else reject(new Error(`wrangler secret put ${write.name} --env ${write.env} failed`));
    });
    child.stdin.end(write.value);
  });
}

function codeOf(input: string | undefined): string | null {
  if (input === undefined) return null;
  if (!input.startsWith('http')) return input;
  return new URL(input).searchParams.get('code');
}

const code = codeOf(process.argv[2]);
if (code === null) {
  console.error('Usage: pnpm github-apps:convert <code, or the whole address GitHub landed on>');
  process.exit(1);
}
await convertApp(code, {
  fetch: (url, init) => fetch(url, init),
  putSecret,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  log: (line) => console.log(line),
});
