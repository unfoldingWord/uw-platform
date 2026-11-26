import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const runner = 'infra/containers/measure/runner.py';
const ADDRESS = 'https://x.test/';
const HOST = 'x.test';
const workspaces: string[] = [];

type Envelope = {
  readonly exit_code: number | null;
  readonly timed_out: boolean;
  readonly stdout: string;
  readonly stderr_tail: string;
};

function workspaceWith(tools: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), 'measure-runner-'));
  workspaces.push(workspace);
  const bin = join(workspace, 'venv', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, script] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return workspace;
}

function runnerSays(
  workspace: string,
  args: readonly string[],
  authority = join(workspace, 'missing-ca.crt'),
): Envelope {
  const done = spawnSync('python3', [runner, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      MEASURE_WORKSPACE: workspace,
      MEASURE_CA: authority,
      LEAKED_VALUE: 'x',
    },
    timeout: 30_000,
  });
  expect(done.status).toBe(0);
  return JSON.parse(done.stdout) as Envelope;
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe('the measure runner inside the container', () => {
  it('runs the tool from the installed package with its arguments, never through a shell', () => {
    const workspace = workspaceWith({ geo: 'printf "%s|" "$@"; echo "warned" >&2; exit 3' });
    const said = runnerSays(workspace, [
      'run',
      '5000',
      '1000',
      ADDRESS,
      HOST,
      '--',
      'geo',
      'audit',
      '--url',
      'https://x.test/?a=1;b=$(id)',
    ]);
    expect(said).toEqual({
      exit_code: 3,
      timed_out: false,
      stdout: 'audit|--url|https://x.test/?a=1;b=$(id)|',
      stderr_tail: 'warned\n',
    });
  });

  it('hands the tool a clean environment that trusts only the container CA', () => {
    const workspace = workspaceWith({ geo: 'env | sort' });
    const authority = join(workspace, 'cloudflare-containers-ca.crt');
    writeFileSync(authority, 'certificate');
    const said = runnerSays(
      workspace,
      ['run', '5000', '10000', ADDRESS, HOST, '--', 'geo'],
      authority,
    );
    const names = said.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=')[0]);
    expect(names).not.toContain('LEAKED_VALUE');
    expect(names).not.toContain('MEASURE_WORKSPACE');
    expect(names).not.toContain('MEASURE_CA');
    expect(said.stdout).toContain(`HOME=${workspace}\n`);
    for (const name of ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE']) {
      expect(said.stdout).toContain(`${name}=${authority}\n`);
    }
  });

  it('falls back to the system bundle where no container CA is mounted, as in the CI smoke run', () => {
    const workspace = workspaceWith({ geo: 'env | sort' });
    const said = runnerSays(workspace, ['run', '5000', '10000', ADDRESS, HOST, '--', 'geo']);
    expect(said.stdout).toContain('SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt\n');
  });
});

describe('the measure runner fills the template', () => {
  it('fills the address and host into the template once, however long the address', () => {
    const workspace = workspaceWith({ geo: 'printf "%s|" "$@"' });
    const address = `https://x.test/${'a'.repeat(600)}?next={host}`;
    const template = ['geo', '--url', '{address}', '--host={host}', '{address}{host}'];
    const said = runnerSays(workspace, ['run', '5000', '10000', address, HOST, '--', ...template]);
    expect(said.stdout).toBe(`--url|${address}|--host=${HOST}|${address}${HOST}|`);
  });
});

describe('the measure runner limits and refusals', () => {
  it('stops a tool that runs too long and caps what it prints', () => {
    const workspace = workspaceWith({
      slow: 'sleep 20',
      loud: 'i=0; while [ $i -lt 400 ]; do printf "0123456789"; i=$((i+1)); done',
    });
    const started = Date.now();
    const slow = runnerSays(workspace, ['run', '500', '1000', ADDRESS, HOST, '--', 'slow']);
    expect(slow).toMatchObject({ exit_code: null, timed_out: true });
    expect(Date.now() - started).toBeLessThan(10_000);
    const loud = runnerSays(workspace, ['run', '5000', '25', ADDRESS, HOST, '--', 'loud']);
    expect(loud).toMatchObject({ exit_code: 0, stdout: '0123456789012345678901234' });
  });

  it('refuses a tool the package does not install', () => {
    const workspace = workspaceWith({});
    for (const name of ['geo', '../../../bin/sh', 'sh']) {
      const said = runnerSays(workspace, ['run', '5000', '1000', ADDRESS, HOST, '--', name]);
      expect(said).toMatchObject({ exit_code: 127, timed_out: false, stdout: '' });
    }
  });

  it('skips the install when the venv already holds this exact lock', () => {
    const workspace = workspaceWith({});
    const lock = 'geo-optimizer-skill==4.19.10 \\\n    --hash=sha256:bb\n';
    writeFileSync(join(workspace, 'requirements.txt'), lock);
    const digest = createHash('sha256').update(lock).digest('hex');
    writeFileSync(join(workspace, 'venv', '.measure-lock'), digest);
    expect(runnerSays(workspace, ['install', '5000'])).toEqual({
      exit_code: 0,
      timed_out: false,
      stdout: '',
      stderr_tail: '',
    });
  });

  it('refuses a package spec that reads as an option', () => {
    const workspace = workspaceWith({});
    const said = runnerSays(workspace, ['lock', '5000', '--index-url=https://evil.test']);
    expect(said).toMatchObject({ exit_code: 2, stdout: '' });
  });
});
