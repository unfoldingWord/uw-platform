import { describe, expect, it } from 'vitest';
import { runSession } from './session.ts';
import { fakeContainerHost } from './testing.ts';

const egressNone = async (): Promise<Response> => new Response('egress refused', { status: 403 });

function steppingClock(steps: readonly number[]): () => Date {
  let index = 0;
  return () => {
    const at = steps[Math.min(index, steps.length - 1)] ?? 0;
    index += 1;
    return new Date(at);
  };
}

const spec = {
  sessionId: 'run-1-1',
  files: [{ path: '/workspace/PROMPT.md', content: 'Work the item.' }],
  command: ['echo', 'done'],
  env: { HOME: '/workspace' },
  timeoutMs: 60_000,
  egress: egressNone,
  admit: async () => true,
  finish: null,
};

async function destroyedAlways(): Promise<void> {
  const host = fakeContainerHost([{ exitCode: 0, stdout: 'done', stderr: '' }]);
  const ran = await runSession(host, spec, steppingClock([0, 90_000]));
  expect(ran).toEqual({
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    wallMs: 90_000,
    finished: null,
  });
  expect(host.sessions).toMatchObject([
    {
      id: 'run-1-1',
      files: [{ path: '/workspace/PROMPT.md', content: 'Work the item.' }],
      commands: [{ command: ['echo', 'done'], env: { HOME: '/workspace' }, timeoutMs: 60_000 }],
      destroyed: true,
    },
  ]);
  const failing = fakeContainerHost([new Error('the container stopped')]);
  await expect(runSession(failing, spec, steppingClock([0]))).rejects.toThrow(
    'the container stopped',
  );
  expect(failing.sessions.map((session) => session.destroyed)).toEqual([true]);
}

describe('a sandbox session', () => {
  it('HE-8 the sandbox is destroyed after the step, also when the command fails', destroyedAlways);
});
