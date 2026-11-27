import { describe, expect, it } from 'vitest';
import { probeMain, type ProbeIo } from './probe-assistants-cli.ts';

function io(env: Record<string, string | undefined>, files: Record<string, string> = {}) {
  const printed: string[] = [];
  const called: string[] = [];
  const value: ProbeIo = {
    env,
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    fetcher: async (input) => {
      called.push(String(input));
      throw new Error('no network in this test');
    },
    print: (line) => printed.push(line),
    now: () => new Date('2026-11-27T09:00:00.000Z'),
  };
  return { value, printed, called };
}

describe('go-live: pnpm probe:assistants runs the staging probes from a terminal', () => {
  it('reads only, prints one line a probe and a total, and exits 0 when nothing failed', async () => {
    const run = io({});
    expect(await probeMain([], run.value)).toBe(0);
    expect(run.called).toEqual([]);
    expect(run.printed.at(0)).toMatch(/reads only/);
    expect(run.printed.some((line) => /^SKIP\s+s3\.1\s/.test(line))).toBe(true);
    expect(run.printed.some((line) => /^MANUAL\s+s4\.2\s/.test(line))).toBe(true);
    expect(run.printed.at(-1)).toMatch(/^0 pass, 0 fail, \d+ skip, \d+ manual$/);
  });

  it('says it writes when asked with --write', async () => {
    const run = io({});
    expect(await probeMain(['--write'], run.value)).toBe(0);
    expect(run.printed.at(0)).toMatch(/creates and removes a probe bot/);
  });

  it('refuses an unknown argument with its usage and exit 2', async () => {
    const run = io({});
    expect(await probeMain(['--wrtie'], run.value)).toBe(2);
    expect(run.printed.join('\n')).toMatch(/Usage: pnpm probe:assistants/);
  });

  it('reads the service account key from GOOGLE_WORKSPACE_KEY_FILE and reports a call it could not make as failed', async () => {
    const key = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'x' });
    const run = io(
      {
        GOOGLE_WORKSPACE_KEY_FILE: '/keys/sa.json',
        GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org',
        PROBE_PERSON_EMAIL: 'ana@unfoldingword.org',
      },
      { '/keys/sa.json': key },
    );
    expect(await probeMain([], run.value)).toBe(1);
    expect(run.printed.some((line) => /^FAIL\s+s5\.1\s+key_invalid/.test(line))).toBe(true);
  });
});
