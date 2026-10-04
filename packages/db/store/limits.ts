const maxRows = 5000;

export function checkedRows(limit: number, what: string): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxRows) {
    throw new RangeError(`a ${what} read holds 1 to ${maxRows} rows, not ${limit}`);
  }
  return limit;
}
