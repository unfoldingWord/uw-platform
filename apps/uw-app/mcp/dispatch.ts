import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { verbIo, type VerbDefinition, type VerbName } from '@uw/contracts';
import { actionForVerbRole, can, type AclResource } from '@uw/core/acl';
import { errorFields } from '@uw/core/log';
import { PortNotWiredError } from '@uw/harness';
import type { VerbContext } from './context.ts';
import {
  refusal,
  type GatedHandler,
  type VerbHandler,
  type VerbInput,
  type VerbRefusal,
} from './handler.ts';
import { servedVerb } from './tools.ts';

type Input = VerbInput<VerbName>;
type Parsed =
  | { readonly ok: true; readonly input: Input }
  | { readonly ok: false; readonly refusal: VerbRefusal };
type Answer =
  { readonly status: 'accepted'; readonly output: Record<string, unknown> } | VerbRefusal;

const inputSchemas = new Map(Object.entries(verbIo).map(([name, io]) => [name, io.input]));

function parsedInput(name: VerbName, args: unknown): Parsed {
  const schema = inputSchemas.get(name);
  if (schema === undefined) throw new Error(`verb ${name} has no input schema`);
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return { ok: true, input: parsed.data };
  const fields = parsed.error.issues.map((issue) => issue.path.map(String).join('.'));
  return { ok: false, refusal: refusal('malformed_command', { fields: [...new Set(fields)] }) };
}

function isRefusal(value: AclResource | VerbRefusal): value is VerbRefusal {
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
): Promise<VerbRefusal | null> {
  const resource = await handler.resource(context, input);
  if (isRefusal(resource)) return resource;
  const { principal, at } = context;
  if (!can(principal, 'read', resource, at)) return refusal(handler.hiddenAs);
  const action = actionForVerbRole(definition.grant?.role ?? 'admin');
  const target = grantResource(definition, resource);
  return can(principal, action, target, at) ? null : refusal('not_permitted');
}

async function replyOf(
  context: VerbContext,
  definition: VerbDefinition,
  handler: VerbHandler,
  input: Input,
): Promise<Answer> {
  if (handler.kind === 'gated') {
    const refused = await gate(context, definition, handler, input);
    if (refused !== null) return refused;
  }
  const reply = await handler.run(context, input);
  if (reply.status === 'error') return reply;
  return {
    status: 'accepted',
    output: structured(definition.name, definition.output.parse(reply.output)),
  };
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

export async function callVerb(
  context: VerbContext,
  name: string,
  args: unknown,
  handlers: ReadonlyMap<string, VerbHandler>,
): Promise<CallToolResult> {
  const definition = servedVerb(name, context.principal, context.at);
  if (definition === null) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  const handler = handlers.get(definition.name);
  if (handler === undefined) return resultOf(refusal('not_wired'));
  try {
    const parsed = parsedInput(definition.name, args);
    if (!parsed.ok) return resultOf(parsed.refusal);
    return resultOf(await replyOf(context, definition, handler, parsed.input));
  } catch (error) {
    return resultOf(failed(context, definition.name, error));
  }
}
