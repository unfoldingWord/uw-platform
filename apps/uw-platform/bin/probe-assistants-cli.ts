import { exitCodeOf, reportLines } from '../assistants/probes/report.ts';
import { runAssistantProbes, type ProbeEnv } from '../assistants/probes/run.ts';

export type ProbeIo = {
  readonly env: ProbeEnv;
  readonly readFile: (path: string) => string;
  readonly fetcher: typeof fetch;
  readonly print: (line: string) => void;
  readonly now: () => Date;
};

const USAGE = [
  'Usage: pnpm probe:assistants [-- --write]',
  'Reads its settings from the environment (node --env-file works): the Worker variable names,',
  'GOOGLE_WORKSPACE_KEY or GOOGLE_WORKSPACE_KEY_FILE, and PROBE_PERSON_EMAIL, PROBE_COLLEAGUE_EMAIL,',
  'PROBE_ASSISTANT_MAILBOX. Without --write it only reads; with it, it creates and removes a probe',
  'bot, a probe Workspace user and a probe hold, and sends one DM and one email to the probe person.',
];

function withKey(io: ProbeIo): ProbeEnv {
  const path = io.env['GOOGLE_WORKSPACE_KEY_FILE'];
  if (path === undefined || path === '' || io.env['GOOGLE_WORKSPACE_KEY'] !== undefined) {
    return io.env;
  }
  return { ...io.env, GOOGLE_WORKSPACE_KEY: io.readFile(path) };
}

function suffix(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 6);
}

export async function probeMain(argv: readonly string[], io: ProbeIo): Promise<number> {
  const args = argv.filter((arg) => arg !== '--');
  if (args.some((arg) => arg !== '--write')) {
    USAGE.forEach(io.print);
    return 2;
  }
  const write = args.includes('--write');
  io.print(
    write
      ? 'Probing with --write: creates and removes a probe bot, a probe user and a probe hold.'
      : 'Probing (reads only; add --write for the probes that create and remove things).',
  );
  const results = await runAssistantProbes({
    env: withKey(io),
    fetcher: io.fetcher,
    now: io.now,
    write,
    suffix: suffix(),
  });
  reportLines(results).forEach(io.print);
  return exitCodeOf(results);
}
