import { z } from 'zod';
import { findVerb, type VerbName } from '@uw/contracts';

export type ToolSchema = {
  readonly name: VerbName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown> & { readonly type: 'object' };
};

export function toolSchema(verb: VerbName): ToolSchema {
  const definition = findVerb(verb);
  if (definition === undefined) throw new Error(`no verb named ${verb}`);
  const schema = z.toJSONSchema(definition.input, { io: 'input' });
  if (schema['type'] !== 'object') throw new Error(`verb ${verb} takes no object`);
  return {
    name: verb,
    description: definition.summary,
    inputSchema: { ...schema, type: 'object' },
  };
}
