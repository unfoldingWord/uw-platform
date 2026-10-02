import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorReasonSchema, findVerb, type ErrorReason } from '@uw/contracts';
import type { McpHost } from '../mcp/context.ts';

export type ToolSurface = { readonly host: McpHost; readonly tools: readonly Tool[] };

function byName(surface: ToolSurface): ReadonlyMap<string, Tool> {
  return new Map(surface.tools.map((tool) => [tool.name, tool]));
}

function againstServed(surface: ToolSurface, served: readonly string[]): string[] {
  const names = byName(surface);
  const wanted = new Set(served);
  return [
    ...served.filter((name) => !names.has(name)).map((name) => `${surface.host} lacks ${name}`),
    ...[...names.keys()]
      .filter((name) => !wanted.has(name))
      .map((name) => `${surface.host} serves unregistered ${name}`),
  ];
}

function schemaDifferences(one: Tool, other: Tool): string[] {
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  return [
    ...(differs(one.inputSchema, other.inputSchema) ? ['inputSchema'] : []),
    ...(differs(one.outputSchema, other.outputSchema) ? ['outputSchema'] : []),
  ];
}

function betweenSurfaces(one: ToolSurface, other: ToolSurface): string[] {
  const mine = byName(one);
  const theirs = byName(other);
  const pair = `${one.host} and ${other.host}`;
  const mismatches: string[] = [];
  for (const name of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(name);
    const b = theirs.get(name);
    if (a === undefined || b === undefined) {
      mismatches.push(`${name} is served by only one of ${pair}`);
      continue;
    }
    for (const schema of schemaDifferences(a, b)) {
      mismatches.push(`${name} ${schema} differs between ${pair}`);
    }
  }
  return mismatches;
}

export function toolSurfaceMismatches(
  surfaces: readonly ToolSurface[],
  served: readonly string[],
): string[] {
  const [first, ...rest] = surfaces;
  return [
    ...surfaces.flatMap((surface) => againstServed(surface, served)),
    ...(first === undefined ? [] : rest.flatMap((surface) => betweenSurfaces(first, surface))),
  ];
}

function isUnknownTool(outcome: unknown): boolean {
  return (
    outcome instanceof McpError &&
    outcome.code === Number(ErrorCode.InvalidParams) &&
    outcome.message.includes('Unknown tool:')
  );
}

type Expected = 'accepted' | ErrorReason;

export type CallResult = {
  readonly verb: string;
  readonly outcome: unknown;
  readonly expected: Expected;
};

const BROKEN: ReadonlySet<string> = new Set(['internal_error', 'not_wired', 'malformed_command']);

function refusalBody(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return null;
  }
}

function closedReason(text: string | undefined): ErrorReason | null {
  const body = refusalBody(text);
  if (typeof body !== 'object' || body === null || !('reason' in body)) return null;
  const reason = errorReasonSchema.safeParse(body.reason);
  return reason.success ? reason.data : null;
}

function answerOf(verb: string, outcome: unknown): Expected | null {
  const result = CallToolResultSchema.safeParse(outcome);
  if (!result.success) return null;
  if (result.data.isError === true) {
    const block = result.data.content.find((content) => content.type === 'text');
    return closedReason(block?.type === 'text' ? block.text : undefined);
  }
  const output = findVerb(verb)?.output;
  const fits = output !== undefined && output.safeParse(result.data.structuredContent).success;
  return fits ? 'accepted' : null;
}

function failureOf(host: McpHost, call: CallResult): string | null {
  const { verb, outcome, expected } = call;
  if (isUnknownTool(outcome)) return `${host} answered ${verb} as an unknown tool`;
  const answer = answerOf(verb, outcome);
  if (answer === null)
    return `${host} answered ${verb} with neither its output nor a closed refusal`;
  if (BROKEN.has(answer)) return `${host} answered ${verb} ${answer}`;
  return answer === expected ? null : `${host} answered ${verb} ${answer}, not ${expected}`;
}

export function callableFailures(host: McpHost, results: readonly CallResult[]): string[] {
  return results.flatMap((call) => failureOf(host, call) ?? []);
}
