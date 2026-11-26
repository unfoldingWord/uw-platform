import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  isForbiddenVerbName,
  verbRegistry,
  type Principal,
  type VerbDefinition,
} from '@uw/contracts';
import { actionForVerbRole, can } from '@uw/core/acl';
import type { McpHost } from './context.ts';

type ObjectSchema = Record<string, unknown> & { readonly type: 'object' };

function servedOn(host: McpHost, verb: VerbDefinition): boolean {
  return verb.group === 'assistant' ? host === 'assistant' : verb.servedInV1;
}

function offered(principal: Principal, at: Date, verb: VerbDefinition, host: McpHost): boolean {
  if (!servedOn(host, verb) || isForbiddenVerbName(verb.name)) return false;
  const grant = verb.grant;
  if (grant?.scope !== 'fixed_area') return true;
  return can(principal, actionForVerbRole(grant.role), { kind: 'area', area: grant.area }, at);
}

function objectSchema(verb: string, schema: Record<string, unknown>): ObjectSchema {
  if (schema['type'] !== 'object')
    throw new Error(`verb ${verb} has a schema that is not an object`);
  return { ...schema, type: 'object' };
}

function toolOf(verb: VerbDefinition): Tool {
  return {
    name: verb.name,
    description: verb.summary,
    inputSchema: objectSchema(verb.name, z.toJSONSchema(verb.input, { io: 'input' })),
    outputSchema: objectSchema(verb.name, z.toJSONSchema(verb.output, { io: 'output' })),
  };
}

export function toolsFor(
  principal: Principal,
  at: Date,
  registry: readonly VerbDefinition[] = verbRegistry,
  host: McpHost = 'external',
): Tool[] {
  return registry.filter((verb) => offered(principal, at, verb, host)).map(toolOf);
}

const indexes = new WeakMap<readonly VerbDefinition[], ReadonlyMap<string, VerbDefinition>>();

function indexOf(registry: readonly VerbDefinition[]): ReadonlyMap<string, VerbDefinition> {
  const known = indexes.get(registry);
  if (known !== undefined) return known;
  const index = new Map<string, VerbDefinition>(registry.map((verb) => [verb.name, verb]));
  indexes.set(registry, index);
  return index;
}

export function servedVerb(
  name: string,
  principal: Principal,
  at: Date,
  registry: readonly VerbDefinition[] = verbRegistry,
  host: McpHost = 'external',
): VerbDefinition | null {
  const verb = indexOf(registry).get(name);
  return verb !== undefined && offered(principal, at, verb, host) ? verb : null;
}
