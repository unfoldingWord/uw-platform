import { z } from 'zod';

const segment = '[A-Za-z0-9][A-Za-z0-9_-]*';
const human = `human:${segment}`;
const agent = `agent:${segment}`;
const device = `agent:${segment}/${segment}`;
const delegated = `agent:${segment}/${segment} as ${segment} via delegation:${segment}`;

export const identityPattern = `^(?:${human}|${agent}|${device}|${delegated})$`;

export const identitySchema = z
  .string()
  .regex(new RegExp(identityPattern), 'not an identity string')
  .brand<'Identity'>();

export type Identity = z.infer<typeof identitySchema>;
