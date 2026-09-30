import { z } from 'zod';

const requestId = z.uuid();

const plain = <Name extends string>(name: Name) =>
  z.object({ command: z.literal(name), requestId });

export const commandNames = [
  'kickstart',
  'enqueue',
  'import',
  'reorder',
  'claim',
  'release',
  'submit_to_gate',
  'approve',
  'reject',
  'take_over',
  'override',
  'prompt_run',
  'stop_run',
  'pause',
  'resume',
  'tweak_package',
  'schedule_regular_tweak',
] as const;

export const commandNameSchema = z.enum(commandNames);

export const overrideCommandSchema = z.object({
  command: z.literal('override'),
  requestId,
  reason: z.string().min(1),
});

export const commandSchema = z.discriminatedUnion('command', [
  plain('kickstart'),
  plain('enqueue'),
  plain('import'),
  plain('reorder'),
  plain('claim'),
  plain('release'),
  plain('submit_to_gate'),
  plain('approve'),
  plain('reject'),
  plain('take_over'),
  overrideCommandSchema,
  plain('prompt_run'),
  plain('stop_run'),
  plain('pause'),
  plain('resume'),
  plain('tweak_package'),
  plain('schedule_regular_tweak'),
]);

export type CommandName = z.infer<typeof commandNameSchema>;
export type Command = z.infer<typeof commandSchema>;
