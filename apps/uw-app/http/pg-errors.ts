function field(error: unknown, key: string): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : null;
}

function fromErrorOrCause(error: unknown, key: string): string | null {
  const direct = field(error, key);
  if (direct !== null) return direct;
  if (typeof error !== 'object' || error === null) return null;
  return field(Reflect.get(error, 'cause'), key);
}

export function pgErrorCode(error: unknown): string | null {
  return fromErrorOrCause(error, 'code');
}

export function pgConstraint(error: unknown): string | null {
  return fromErrorOrCause(error, 'constraint_name');
}
