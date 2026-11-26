import { describe, expect, it } from 'vitest';
import { SANDBOX_LIMITS } from '../../measures/sandbox.ts';
import { dohResolver } from './measure-address.ts';
import { measureEgress } from './measure-egress.ts';
import {
  installIn,
  lockIsPinned,
  MEASURE_HOST_LIMITS,
  measureGate,
  measureIn,
  measureInstallJobSchema,
  measureJobSchema,
  type MeasureGate,
  type SandboxMeasureJob,
} from './measure-host.ts';

type Egress = (request: Request) => Promise<Response>;
type Envelope = {
  readonly exit_code: number | null;
  readonly timed_out: boolean;
  readonly stdout: string;
  readonly stderr_tail: string;
};
type Step = (egress: Egress) => Promise<Envelope | string>;

const HASH_A = `--hash=sha256:${'a'.repeat(64)}`;
const HASH_B = `--hash=sha256:${'b'.repeat(64)}`;
const LOCK = [
  'certifi==2026.1.4 \\',
  `    ${HASH_A}`,
  "colorama==0.4.6 ; sys_platform == 'win32' \\",
  `    ${HASH_A} \\`,
  `    ${HASH_B}`,
  'geo-optimizer-skill==4.19.10 \\',
  `    ${HASH_B}`,
  '',
].join('\n');

function envelope(stdout: string, exitCode: number | null = 0, timedOut = false): Envelope {
  return { exit_code: exitCode, timed_out: timedOut, stdout, stderr_tail: '' };
}

const upstream = async (request: Request) => new Response(`from ${request.url}`);
const publicDns = async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] });
const fetcher = async (request: Request) =>
  new URL(request.url).hostname === 'cloudflare-dns.com' ? publicDns() : upstream(request);

function fakeContainer(steps: Record<string, Step>) {
  const log: string[] = [];
  const gate: MeasureGate = measureGate(dohResolver(fetcher));
  const egress: Egress = (request) => measureEgress(request, gate.route, fetcher);
  const container = {
    writeFile: async (path: string, content: string) => void log.push(`write ${path} ${content}`),
    exec: async (command: string[], _env: Record<string, string>, timeoutMs: number) => {
      log.push(`exec ${command.join(' ')} @${String(timeoutMs)}`);
      const step = steps[command[2] ?? ''];
      if (step === undefined) throw new Error('unscripted');
      const reply = await step(egress);
      const stdout = typeof reply === 'string' ? reply : JSON.stringify(reply);
      return { exitCode: 0, stdout, stderr: '' };
    },
  };
  return { container, gate, egress, log };
}

const job: SandboxMeasureJob = {
  runId: 'run-1',
  runtime: 'uvx',
  packageSpec: 'geo-optimizer-skill==4.19.10',
  lock: null,
  command: ['geo', 'audit', '--url', '{address}', '--host={host}'],
  address: 'https://www.example.org/start',
  timeoutMs: 60_000,
  outputLimitBytes: 1_048_576,
};

async function statusOf(egress: Egress, url: string): Promise<number> {
  return (await egress(new Request(url))).status;
}

function trialSteps(seen: string[]): Record<string, Step> {
  return {
    lock: async (egress) => {
      seen.push(`lock pypi ${String(await statusOf(egress, 'https://pypi.org/simple/x/'))}`);
      return envelope(LOCK);
    },
    install: async (egress) => {
      seen.push(`install site ${String(await statusOf(egress, 'https://www.example.org/'))}`);
      return envelope('');
    },
    run: async (egress) => {
      seen.push(`run site ${String(await statusOf(egress, 'https://www.example.org/a'))}`);
      seen.push(`run pypi ${String(await statusOf(egress, 'https://pypi.org/simple/x/'))}`);
      seen.push(`run other ${String(await statusOf(egress, 'https://cdn.example.net/x'))}`);
      return envelope('{"score": 71}');
    },
  };
}

describe('the measure sandbox on a trial', () => {
  it('locks the package, installs it, and runs the tool against one resource', async () => {
    const seen: string[] = [];
    const rig = fakeContainer(trialSteps(seen));
    const result = await measureIn(rig.container, rig.gate, job);
    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      stdout: '{"score": 71}',
      stderrTail: '',
      refusedHosts: ['cdn.example.net', 'pypi.org', 'www.example.org'],
      lock: LOCK,
      toolVersion: '4.19.10',
    });
    expect(seen).toEqual([
      'lock pypi 200',
      'install site 403',
      'run site 200',
      'run pypi 403',
      'run other 403',
    ]);
    expect(rig.log).toEqual([
      'exec python3 /opt/measure/runner.py lock 120000 geo-optimizer-skill==4.19.10 @150000',
      `write /workspace/requirements.txt ${LOCK}`,
      'exec python3 /opt/measure/runner.py install 300000 @330000',
      'exec python3 /opt/measure/runner.py run 60000 1048576 -- geo audit --url https://www.example.org/start --host=www.example.org @90000',
    ]);
    expect(await statusOf(rig.egress, 'https://www.example.org/')).toBe(403);
  });
});

describe('the measure sandbox installing a package on its own', () => {
  const install = { runId: 'run-1', runtime: 'uvx' as const, packageSpec: job.packageSpec };

  it('locks and installs the package and runs no tool', async () => {
    const seen: string[] = [];
    const rig = fakeContainer(trialSteps(seen));
    const result = await installIn(rig.container, rig.gate, { ...install, lock: null });
    expect(result).toEqual({
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderrTail: '',
      refusedHosts: ['www.example.org'],
      lock: LOCK,
      toolVersion: '4.19.10',
    });
    expect(seen).toEqual(['lock pypi 200', 'install site 403']);
    expect(rig.log.some((line) => line.includes(' run '))).toBe(false);
    expect(rig.gate.route.phase()).toEqual({ kind: 'closed' });
  });

  it('says why an install failed, and keeps the lock it tried', async () => {
    const rig = fakeContainer({ install: async () => envelope('', null, true) });
    const result = await installIn(rig.container, rig.gate, { ...install, lock: LOCK });
    expect(result).toMatchObject({ exitCode: null, timedOut: true, lock: LOCK, toolVersion: null });
  });

  it('reads an install job as the measures module sends it, and nothing more', () => {
    expect(measureInstallJobSchema.parse({ ...install, lock: LOCK })).toEqual({
      ...install,
      lock: LOCK,
    });
    expect(measureInstallJobSchema.safeParse({ ...install, lock: null, extra: 1 }).success).toBe(
      false,
    );
  });

  it('holds each runner call to the limits the measure run budgets its steps by', () => {
    const { lockMs, installMs, graceMs } = SANDBOX_LIMITS;
    expect(MEASURE_HOST_LIMITS).toEqual({ lockMs, installMs, graceMs });
  });
});

describe('the measure sandbox on a scheduled run', () => {
  it('installs exactly the lock it is given and never resolves the package again', async () => {
    const rig = fakeContainer({
      install: async () => envelope(''),
      run: async () => envelope('[]', 2),
    });
    const result = await measureIn(rig.container, rig.gate, { ...job, lock: LOCK });
    expect(result).toMatchObject({ exitCode: 2, stdout: '[]', lock: LOCK, refusedHosts: [] });
    expect(rig.log.filter((line) => line.includes(' lock '))).toEqual([]);
  });

  it('refuses a lock that holds anything but pinned, hashed requirements, and runs nothing', async () => {
    for (const line of ['--index-url https://evil.test/simple', '-e git+https://x.test/y']) {
      const rig = fakeContainer({});
      const lock = `${line}\n${LOCK}`;
      const result = await measureIn(rig.container, rig.gate, { ...job, lock });
      expect(result).toMatchObject({ exitCode: 2, stdout: '', lock, toolVersion: null });
      expect(result.stderrTail).toBe('the lock holds a line that is not a pinned, hashed package');
      expect(rig.log).toEqual([]);
    }
  });
});

describe('the measure sandbox when a step fails', () => {
  it('stops after a lock or install that fails, and says why', async () => {
    const failing = fakeContainer({
      lock: async () => ({ ...envelope('', 1), stderr_tail: 'no' }),
    });
    const trial = await measureIn(failing.container, failing.gate, job);
    expect(trial).toMatchObject({ exitCode: 1, stderrTail: 'no', lock: '', toolVersion: null });
    const slow = fakeContainer({ install: async () => envelope('', null, true) });
    const locked = await measureIn(slow.container, slow.gate, { ...job, lock: LOCK });
    expect(locked).toMatchObject({ exitCode: null, timedOut: true, stdout: '', lock: LOCK });
    expect(slow.log.some((line) => line.includes(' run '))).toBe(false);
  });

  it('throws when the runner answers out of shape, and closes the egress again', async () => {
    const rig = fakeContainer({ install: async () => 'Traceback (most recent call last)' });
    await expect(measureIn(rig.container, rig.gate, { ...job, lock: LOCK })).rejects.toThrow(
      'the measure runner answered out of shape',
    );
    expect(rig.gate.route.phase()).toEqual({ kind: 'closed' });
  });
});

describe('the measure job a run hands the sandbox', () => {
  it('reads a job as the measures module sends it', () => {
    expect(measureJobSchema.parse(job)).toEqual(job);
    expect(measureJobSchema.parse({ ...job, address: 'http://example.org:8080/' }).address).toBe(
      'http://example.org:8080/',
    );
  });

  it('refuses an address that is not a plain web address, and a package that is not pinned', () => {
    const wrong = [
      { address: 'file:///etc/passwd' },
      { address: 'https://user:secret@example.org/' },
      { address: 'not a url' },
      { packageSpec: 'geo-optimizer-skill' },
      { packageSpec: '--index-url=https://evil.test' },
      { command: [] },
      { timeoutMs: 0 },
      { extra: true },
    ];
    for (const change of wrong)
      expect(measureJobSchema.safeParse({ ...job, ...change }).success).toBe(false);
  });

  it('reads a lock as pinned only when every line is a pin or a hash', () => {
    expect(lockIsPinned(LOCK)).toBe(true);
    expect(lockIsPinned('')).toBe(false);
    expect(lockIsPinned('geo==1.0 \\\n')).toBe(false);
    expect(lockIsPinned(`geo>=1.0 \\\n    ${HASH_A}\n`)).toBe(false);
    expect(lockIsPinned(`geo==1.0 \\\n    ${HASH_A}\n--extra-index-url https://x.test\n`)).toBe(
      false,
    );
  });
});
