import { z } from 'zod';

const idSchema = z.uuid();

export function idParam(raw: string | undefined): string | null {
  const parsed = idSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
