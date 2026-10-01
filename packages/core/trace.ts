import { z } from 'zod';

export const TRACE_HEADER = 'x-trace-id';
export const traceIdSchema = z.uuid();
