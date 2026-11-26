import { describe, expect, it } from 'vitest';
import type { Bindings, MeasureContainerNamespace, SandboxNamespace } from '../../env.ts';
import {
  ClaudeCodeSandbox,
  CodexSandbox,
  MeasureSandbox,
  measureSandboxSettings,
  routeOutbound,
  sandboxSettings,
} from './classes.ts';

function namespaceWith(seen: string[]): SandboxNamespace {
  const stub = {
    bindEgress: () => Promise.resolve(),
    egressFetch: async (request: Request) => {
      seen.push(request.url);
      return new Response('routed');
    },
    writeFile: () => Promise.resolve(),
    exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    destroy: () => Promise.resolve(),
  };
  return {
    idFromName: (name) => name,
    idFromString: (id) => id,
    get: (id) => {
      seen.push(`instance ${String(id)}`);
      return stub;
    },
  };
}

const context = (className: string) => ({ containerId: 'container-1', className });

describe('the sandbox Durable Object classes', () => {
  it('start with the internet off and route every outbound request through the egress proxy', () => {
    expect(sandboxSettings.enableInternet).toBe(false);
    expect(ClaudeCodeSandbox.outbound).toBe(routeOutbound);
    expect(CodexSandbox.outbound).toBe(routeOutbound);
  });

  it("send a request to the sandbox's own bound egress, and refuse it with no namespace", async () => {
    const seen: string[] = [];
    const env: Bindings = { CLAUDE_CODE_SANDBOX: namespaceWith(seen) };
    const routed = await routeOutbound(
      new Request('http://mcp.internal/mcp'),
      env,
      context('ClaudeCodeSandbox'),
    );
    expect(await routed.text()).toBe('routed');
    expect(seen).toEqual(['instance container-1', 'http://mcp.internal/mcp']);
    for (const className of ['CodexSandbox', 'SomeOtherContainer']) {
      const refused = await routeOutbound(new Request('https://api.github.com/'), env, {
        ...context(className),
      });
      expect(refused.status).toBe(403);
      expect(await refused.text()).toBe('egress refused');
    }
  });
});

function measureNamespaceWith(seen: string[]): MeasureContainerNamespace {
  const stub = {
    egressFetch: async (request: Request) => {
      seen.push(request.url);
      return new Response('routed');
    },
    install: () => Promise.reject(new Error('unused')),
    measure: () => Promise.reject(new Error('unused')),
    release: () => Promise.resolve(),
  };
  return {
    idFromName: (name) => name,
    idFromString: (id) => id,
    get: (id) => {
      seen.push(`instance ${String(id)}`);
      return stub;
    },
  };
}

describe('the measure sandbox Durable Object class', () => {
  it('starts with the internet off, intercepts HTTPS too and routes through its own egress', () => {
    expect(measureSandboxSettings).toEqual({
      enableInternet: false,
      defaultPort: 3000,
      sleepAfter: '5m',
      interceptHttps: true,
    });
    expect(MeasureSandbox.outbound).toBe(routeOutbound);
  });

  it('routes a measure container to the MEASURE_SANDBOX namespace only', async () => {
    const seen: string[] = [];
    const env: Bindings = { MEASURE_SANDBOX: measureNamespaceWith(seen) };
    const routed = await routeOutbound(
      new Request('https://www.example.org/'),
      env,
      context('MeasureSandbox'),
    );
    expect(await routed.text()).toBe('routed');
    expect(seen).toEqual(['instance container-1', 'https://www.example.org/']);
    const refused = await routeOutbound(new Request('https://www.example.org/'), env, {
      ...context('ClaudeCodeSandbox'),
    });
    expect(refused.status).toBe(403);
  });

  it('takes no egress from a caller, because it routes its own', async () => {
    await expect(MeasureSandbox.prototype.bindEgress.call(null)).rejects.toThrow(
      'the measure sandbox routes its own egress',
    );
  });
});

const measureJob = {
  runId: 'run-1',
  runtime: 'uvx',
  packageSpec: 'geo-optimizer-skill==4.19.10',
  lock: null,
  command: ['geo', 'audit', '--url', '{address}'],
  address: 'https://www.example.org/',
  timeoutMs: 60_000,
  outputLimitBytes: 1_048_576,
};

function serialRig() {
  const order: string[] = [];
  const releases: (() => void)[] = [];
  const alone = (job: { readonly runId: string }) => {
    order.push(`start ${job.runId}`);
    return new Promise((resolve, reject) => {
      releases.push(() => {
        order.push(`end ${job.runId}`);
        if (job.runId === 'run-1') reject(new Error('the first job failed'));
        else resolve(job.runId);
      });
    });
  };
  const rig = { queue: { busy: Promise.resolve() }, measureAlone: alone, installAlone: alone };
  return { rig, order, releases };
}

describe('the measure sandbox runs one job at a time', () => {
  it('refuses a job out of shape before it runs anything', async () => {
    const { rig, order } = serialRig();
    const bad = { ...measureJob, address: 'file:///etc/passwd' };
    await expect(MeasureSandbox.prototype.measure.call(rig, bad)).rejects.toThrow();
    await expect(
      MeasureSandbox.prototype.measure.call(rig, { ...measureJob, extra: true }),
    ).rejects.toThrow();
    expect(order).toEqual([]);
  });

  it('starts the next job only after the one before it ends, even when that one failed', async () => {
    const { rig, order, releases } = serialRig();
    const first = MeasureSandbox.prototype.measure.call(rig, measureJob);
    const second = MeasureSandbox.prototype.measure.call(rig, { ...measureJob, runId: 'run-2' });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['start run-1']);
    releases[0]?.();
    await expect(first).rejects.toThrow('the first job failed');
    await Promise.resolve();
    expect(order).toEqual(['start run-1', 'end run-1', 'start run-2']);
    releases[1]?.();
    await expect(second).resolves.toBe('run-2');
  });
});

describe('the measure sandbox shares its queue and its container with one run', () => {
  it('installs in the same queue, so an install and a measure never overlap', async () => {
    const { rig, order, releases } = serialRig();
    const install = { runId: 'run-2', runtime: 'uvx', packageSpec: measureJob.packageSpec };
    const installing = MeasureSandbox.prototype.install.call(rig, { ...install, lock: null });
    const measuring = MeasureSandbox.prototype.measure.call(rig, { ...measureJob, runId: 'run-3' });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['start run-2']);
    releases[0]?.();
    await expect(installing).resolves.toBe('run-2');
    await Promise.resolve();
    expect(order).toEqual(['start run-2', 'end run-2', 'start run-3']);
    releases[1]?.();
    await expect(measuring).resolves.toBe('run-3');
    await expect(
      MeasureSandbox.prototype.install.call(rig, { ...install, lock: null, address: 'x' }),
    ).rejects.toThrow();
  });

  it('stops the container once its run lets it go, but never under a running job', async () => {
    const destroyed: string[] = [];
    const sandbox = (jobs: number, running: boolean) => ({
      jobs,
      ctx: { container: { running } },
      destroy: async () => void destroyed.push(`${String(jobs)} ${String(running)}`),
    });
    await MeasureSandbox.prototype.release.call(sandbox(0, true));
    await MeasureSandbox.prototype.release.call(sandbox(1, true));
    await MeasureSandbox.prototype.release.call(sandbox(0, false));
    expect(destroyed).toEqual(['0 true']);
  });
});

describe('the measure sandbox while a job runs', () => {
  it('keeps the container awake while a job runs instead of stopping it', async () => {
    let renewed = 0;
    const running = { jobs: 1, renewActivityTimeout: () => void (renewed += 1) };
    await MeasureSandbox.prototype.onActivityExpired.call(running);
    expect(renewed).toBe(1);
  });
});
