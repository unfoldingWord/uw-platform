import { z } from 'zod';

const version = z.number().int().min(1);

export const measureRunCommandSchema = z.strictObject({
  command: z.enum(['run_measure_trial', 'run_measure_now']),
  requestId: z.uuid(),
  measureId: z.uuid(),
  expectedVersion: version,
});

export const activateMeasureCommandSchema = z.strictObject({
  command: z.literal('activate_measure'),
  requestId: z.uuid(),
  measureId: z.uuid(),
  expectedVersion: version,
  dashboards: z
    .array(z.uuid())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'each dashboard once')
    .default([]),
});

export const activateDashboardCommandSchema = z.strictObject({
  command: z.literal('activate_dashboard'),
  requestId: z.uuid(),
  dashboardId: z.uuid(),
  expectedVersion: version,
});

export type MeasureRunCommand = z.infer<typeof measureRunCommandSchema>;
export type ActivateMeasureCommand = z.infer<typeof activateMeasureCommandSchema>;
export type ActivateDashboardCommand = z.infer<typeof activateDashboardCommandSchema>;
