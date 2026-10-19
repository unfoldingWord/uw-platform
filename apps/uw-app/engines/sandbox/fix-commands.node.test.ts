import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inOwnSession, killSessionCommand, modelSession } from './fix-commands.ts';

const started: number[] = [];

function memberOf(pid: string): { sid: number; state: string } | null {
  try {
    const stat = readFileSync(join('/proc', pid, 'stat'), 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
    return { sid: Number(fields[3]), state: fields[0] ?? '' };
  } catch {
    return null;
  }
}

function inSession(sid: number): readonly string[] {
  return readdirSync('/proc').filter((pid) => {
    const member = /^\d+$/u.test(pid) ? memberOf(pid) : null;
    return member?.sid === sid && member.state !== 'Z';
  });
}

function settled(sid: number): readonly string[] {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let tries = 0; tries < 20 && inSession(sid).length > 0; tries += 1) {
    Atomics.wait(pause, 0, 0, 100);
  }
  return inSession(sid);
}

function leftRunning(script: string): number {
  const [command, ...args] = inOwnSession(['sh', '-c', `(${script}) >/dev/null 2>&1 & echo ok`]);
  const ran = spawnSync(command ?? 'setsid', args, { encoding: 'utf8', timeout: 20_000 });
  const sid = modelSession(ran.stderr) ?? 0;
  started.push(sid);
  return sid;
}

function killed(sid: number): number | null {
  const script = killSessionCommand(sid)[2] ?? '';
  return spawnSync('sh', ['-c', script], { encoding: 'utf8', timeout: 60_000 }).status;
}

afterEach(() => {
  for (const sid of started.splice(0)) killed(sid);
});

describe('FL-4 the model session is killed whole, on a real shell', () => {
  it('FL-4 a process the model left running in its session is gone after the kill', () => {
    const sid = leftRunning('sleep 120');
    expect(sid).toBeGreaterThan(1);
    expect(inSession(sid)).not.toEqual([]);
    expect(killed(sid)).toBe(0);
    expect(settled(sid)).toEqual([]);
  });

  it('FL-4 children a forking loop starts while the kill runs are stopped and killed too', () => {
    const sid = leftRunning('i=0; while [ $i -lt 2000 ]; do sleep 120 & i=$((i+1)); done; wait');
    expect(inSession(sid)).not.toEqual([]);
    expect(killed(sid)).toBe(0);
    expect(settled(sid)).toEqual([]);
  });
});

describe('FL-4 the kill pauses between passes', () => {
  it('FL-4 a pass that still found a process sleeps briefly before the next, so the 100 passes span time', () => {
    const lines = (killSessionCommand(4242)[2] ?? '').split('\n').map((line) => line.trim());
    const broke = lines.indexOf('[ "$left" = 0 ] && break');
    const pause = lines.indexOf('sleep 0.02');
    const loopEnd = lines.lastIndexOf('done', lines.length - 2);
    expect(broke).toBeGreaterThan(0);
    expect(pause).toBeGreaterThan(broke);
    expect(pause).toBeLessThan(loopEnd);
  });
});
