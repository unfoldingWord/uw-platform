import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  delegationIdOf,
  findVerb,
  verbIo,
  type VerbDefinition,
  type VerbName,
} from '@uw/contracts';
import { actionForVerbRole, can, type AclResource } from '@uw/core/acl';
import { errorFields } from '@uw/core/log';
import { PortNotWiredError } from '@uw/harness';
import { callerOf, type VerbContext } from './context.ts';
import {
  isBuiltHandler,
  refusal,
  type Found,
  type GatedHandler,
  type VerbHandler,
  type VerbInput,
  type VerbRefusal,
  type VerbReply,
} from './handler.ts';
import { servedVerb } from './tools.ts';

type Input = VerbInput<VerbName>;
type Parsed =
  | { readonly ok: true; readonly input: Input }
  | { readonly ok: false; readonly refusal: VerbRefusal };
type Answer =
  { readonly status: 'accepted'; readonly output: Record<string, unknown> } | VerbRefusal;

const ROOT = '(root)';
const NAME_IN_LOG = 64;

const inputSchemas = new Map(Object.entries(verbIo).map(([name, io]) => [name, io.input]));

function parsedInput(name: VerbName, args: unknown): Parsed {
  const schema = inputSchemas.get(name);
  if (schema === undefined) throw new Error(`verb ${name} has no input schema`);
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return { ok: true, input: parsed.data };
  const fields = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || ROOT);
  return { ok: false, refusal: refusal('malformed_command', { fields: [...new Set(fields)] }) };
}

function isRefusal(value: Found<unknown> | VerbRefusal): value is VerbRefusal {
  return 'status' in value;
}

function structured(name: string, output: unknown): Record<string, unknown> {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    throw new Error(`verb ${name} answered an output that is not an object`);
  }
  return Object.fromEntries(Object.entries(output));
}

function grantResource(definition: VerbDefinition, resource: AclResource): AclResource {
  const grant = definition.grant;
  return grant?.scope === 'fixed_area' ? { kind: 'area', area: grant.area } : resource;
}

async function gate(
  context: VerbContext,
  definition: VerbDefinition,
  handler: GatedHandler<VerbName>,
  input: Input,
): Promise<Found<unknown> | VerbRefusal> {
  const found = await handler.resource(context, input);
  if (isRefusal(found)) return found;
  const { principal, at } = context;
  if (!can(principal, 'read', found.resource, at)) return handler.hidden(input);
  const action = actionForVerbRole(definition.grant?.role ?? 'admin');
  const target = grantResource(definition, found.resource);
  return can(principal, action, target, at) ? found : refusal('not_permitted');
}

async function replyOf(
  context: VerbContext,
  definition: VerbDefinition,
  handler: VerbHandler,
  input: Input,
): Promise<Answer> {
  if (handler.kind === 'gated') {
    const found = await gate(context, definition, handler, input);
    if (isRefusal(found)) return found;
    return accepted(definition, await handler.run(context, input, found.found));
  }
  return accepted(definition, await handler.run(context, input));
}

function accepted(definition: VerbDefinition, reply: VerbReply<VerbName>): Answer {
  if (reply.status === 'error') return reply;
  return {
    status: 'accepted',
    output: structured(definition.name, definition.output.parse(reply.output)),
  };
}

function misdeclared(definition: VerbDefinition | undefined, handler: VerbHandler): boolean {
  if (definition === undefined || !isBuiltHandler(handler)) return true;
  return definition.grant !== null && handler.kind !== 'gated';
}

export function assertGatedWhereGranted(handlers: ReadonlyMap<string, VerbHandler>): void {
  for (const [name, handler] of handlers) {
    if (name !== handler.name || misdeclared(findVerb(name), handler)) {
      throw new Error(
        `verb ${name} must be served by a handler builder, gated where the registry grants it, under its own name`,
      );
    }
  }
}

function resultOf(reply: Answer): CallToolResult {
  if (reply.status === 'accepted') {
    return {
      content: [{ type: 'text', text: JSON.stringify(reply.output) }],
      structuredContent: reply.output,
    };
  }
  const body = { status: 'error', reason: reply.reason, detail: reply.detail };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}

function failed(context: VerbContext, name: string, error: unknown): VerbRefusal {
  if (error instanceof PortNotWiredError) return refusal('not_wired');
  context.logger.error('verb failed', {
    outcome: 'internal_error',
    verb: name,
    ...errorFields(error),
  });
  return refusal('internal_error');
}

function logCall(context: VerbContext, name: string, outcome: string): void {
  context.logger.info('verb call', { outcome, verb: name.slice(0, NAME_IN_LOG) });
}

async function delegationRefusal(context: VerbContext): Promise<VerbRefusal | null> {
  const delegationId = delegationIdOf(context.principal.identity);
  if (delegationId === null) return null;
  const beat = await context.kernel.delegations.beat(callerOf(context), { delegationId });
  return beat.status === 'accepted' ? null : refusal(beat.reason, beat.detail);
}

async function answerOf(
  context: VerbContext,
  definition: VerbDefinition,
  args: unknown,
  handler: VerbHandler | undefined,
): Promise<Answer> {
  if (handler === undefined) return refusal('not_wired');
  if (misdeclared(definition, handler)) {
    context.logger.error('verb misdeclared', { outcome: 'internal_error', verb: definition.name });
    return refusal('internal_error');
  }
  try {
    const lapsed = await delegationRefusal(context);
    if (lapsed !== null) return lapsed;
    const parsed = parsedInput(definition.name, args);
    if (!parsed.ok) return parsed.refusal;
    return await replyOf(context, definition, handler, parsed.input);
  } catch (error) {
    return failed(context, definition.name, error);
  }
}

export async function callVerb(
  context: VerbContext,
  name: string,
  args: unknown,
  handlers: ReadonlyMap<string, VerbHandler>,
): Promise<CallToolResult> {
  const definition = servedVerb(name, context.principal, context.at);
  if (definition === null) {
    logCall(context, name, 'unknown_tool');
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  }
  const answer = await answerOf(context, definition, args, handlers.get(definition.name));
  logCall(context, definition.name, answer.status === 'accepted' ? 'accepted' : answer.reason);
  return resultOf(answer);
}
