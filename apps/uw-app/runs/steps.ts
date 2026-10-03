import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { findVerb, recordRunStepReplySchema, type VerbName } from '@uw/contracts';
import type { Detail, RunScene, ToolCaller } from '@uw/harness';
import { connectInProcess, type OpenStep } from '../mcp/in-process.ts';

export type { OpenStep };
import type { RunDeps } from './deps.ts';

export type Halted =
  | { readonly kind: 'hibernated' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'failed'; readonly detail: string };

export type Recorded = {
  readonly step: 'read' | 'scout' | 'work' | 'submit';
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMinor?: number | null;
  readonly computeMinor?: number | null;
  readonly model?: string | null;
  readonly resolvedProvider?: string | null;
  readonly toolsCalled?: readonly VerbName[];
  readonly writes?: number;
};

export class StepHalted extends Error {
  readonly reason: string;
  readonly detail: Detail;

  constructor(reason: string, detail: Detail) {
    super(`the run step halted: ${reason}`);
    this.name = 'StepHalted';
    this.reason = reason;
    this.detail = detail;
  }
}

const endedRuns: ReadonlySet<unknown> = new Set(['run_stopped', 'run_completed', 'run_failed']);
const endingReasons: ReadonlySet<string> = new Set([
  'delegation_lapsed',
  'lease_expired',
  'run_not_found',
]);
const MICROS_PER_MINOR = 10_000;
const refusedSchema = z.object({
  reason: z.string(),
  detail: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});

export function haltedBy(reason: string, detail: Detail): Halted {
  const why = detail['why'];
  if (reason === 'not_permitted' && why === 'run_hibernated') return { kind: 'hibernated' };
  if (reason === 'not_permitted' && endedRuns.has(why)) return { kind: 'ended' };
  if (endingReasons.has(reason)) return { kind: 'ended' };
  return { kind: 'failed', detail: reason };
}

export async function openStep(
  deps: RunDeps,
  runId: string,
  within: ReadonlySet<VerbName> | null,
): Promise<OpenStep | Halted> {
  const opened = await connectInProcess({
    verbKernel: deps.verbKernel,
    runKernel: deps.runKernel,
    host: deps.host,
    runId,
    at: deps.clock.now(),
    db: deps.db,
    commit: deps.commit,
    logger: deps.logger,
    within,
  });
  return opened.status === 'accepted' ? opened.value : haltedBy(opened.reason, opened.detail);
}

export function isOpen(opened: OpenStep | Halted): opened is OpenStep {
  return 'scene' in opened;
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

function outputOf(result: CallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const [first] = Array.isArray(result.content) ? result.content : [];
  const text: unknown = first !== undefined && 'text' in first ? first.text : null;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function callCore(client: Client, verb: VerbName, input: object): Promise<unknown> {
  const result = await client.callTool({ name: verb, arguments: { ...input } });
  const output = outputOf(result);
  if (result.isError === true) {
    const refused = refusedSchema.safeParse(output);
    throw new StepHalted(refused.success ? refused.data.reason : 'refused', {
      ...(refused.success ? refused.data.detail : {}),
    });
  }
  return output;
}

export async function recordStep(open: OpenStep, step: Recorded): Promise<readonly string[]> {
  const { run, item } = open.scene;
  const reply = await callCore(open.core, 'record_run_step', {
    itemId: item.itemId,
    runId: run.id,
    costBasis: 'metered',
    ...step,
  });
  return recordRunStepReplySchema.parse(reply).prompts;
}

export function minorOf(costMicros: number | null): number | null {
  return costMicros === null
    ? null
    : Math.floor((costMicros + MICROS_PER_MINOR / 2) / MICROS_PER_MINOR);
}

export type CountedTools = ToolCaller & { writes(): number };

export function countedTools(client: Client): CountedTools {
  let writes = 0;
  return {
    call: async (verb, input) => {
      if (findVerb(verb)?.grant?.role === 'editor') writes += 1;
      const result = await client.callTool({
        name: verb,
        arguments: typeof input === 'object' && input !== null ? { ...input } : {},
      });
      return { output: outputOf(result), isError: result.isError === true };
    },
    writes: () => writes,
  };
}

export function sceneCaller(scene: RunScene) {
  return { actor: scene.principal, traceId: scene.run.traceId };
}
