import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorReasonSchema, findVerb } from '@uw/contracts';
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

function refusalBody(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return null;
  }
}

function closedRefusal(text: string | undefined): boolean {
  const body = refusalBody(text);
  if (typeof body !== 'object' || body === null || !('reason' in body)) return false;
  return errorReasonSchema.safeParse(body.reason).success;
}

function answered(verb: string, outcome: unknown): boolean {
  const result = CallToolResultSchema.safeParse(outcome);
  if (!result.success) return false;
  if (result.data.isError === true) {
    const block = result.data.content.find((content) => content.type === 'text');
    return closedRefusal(block?.type === 'text' ? block.text : undefined);
  }
  const output = findVerb(verb)?.output;
  return output !== undefined && output.safeParse(result.data.structuredContent).success;
}

function failureOf(host: McpHost, verb: string, outcome: unknown): string | null {
  if (isUnknownTool(outcome)) return `${host} answered ${verb} as an unknown tool`;
  if (!answered(verb, outcome))
    return `${host} answered ${verb} with neither its output nor a closed refusal`;
  return null;
}

export function callableFailures(
  host: McpHost,
  results: readonly { readonly verb: string; readonly outcome: unknown }[],
): string[] {
  return results.flatMap(({ verb, outcome }) => failureOf(host, verb, outcome) ?? []);
}
