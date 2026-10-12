import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  isForbiddenVerbName,
  verbRegistry,
  type Principal,
  type VerbDefinition,
} from '@uw/contracts';
import { actionForVerbRole, can } from '@uw/core/acl';

type ObjectSchema = Record<string, unknown> & { readonly type: 'object' };

function offered(principal: Principal, at: Date, verb: VerbDefinition): boolean {
  if (!verb.servedInV1 || isForbiddenVerbName(verb.name)) return false;
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
): Tool[] {
  return registry.filter((verb) => offered(principal, at, verb)).map(toolOf);
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
): VerbDefinition | null {
  const verb = indexOf(registry).get(name);
  return verb !== undefined && offered(principal, at, verb) ? verb : null;
}
