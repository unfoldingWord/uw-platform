import { z } from 'zod';

export const jdAreaPattern = '^([0-9])0-\\1[9]$';

export const jdAreaSchema = z
  .string()
  .regex(new RegExp(jdAreaPattern), 'a JD area is NN-NN with one decade, for example 80-89');

export type JdArea = z.infer<typeof jdAreaSchema>;
