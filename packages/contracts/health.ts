import { z } from 'zod';

export const indicatorStatusSchema = z.enum(['ok', 'amber', 'red', 'not_configured', 'not_wired']);
export const overallStatusSchema = z.enum(['ok', 'amber', 'red']);

export const healthIndicatorSchema = z.object({
  name: z.string().regex(/^[a-z][a-z_]*$/),
  status: indicatorStatusSchema,
  detail: z.string().max(200),
});

export const healthReportSchema = z.object({
  status: overallStatusSchema,
  commit: z.string().min(1),
  indicators: z.array(healthIndicatorSchema),
});

export type IndicatorStatus = z.infer<typeof indicatorStatusSchema>;
export type OverallStatus = z.infer<typeof overallStatusSchema>;
export type HealthIndicator = z.infer<typeof healthIndicatorSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;
