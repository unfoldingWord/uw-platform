const BATCH = 500;

export async function everyRow<T extends { readonly id: string }>(
  read: (after: string | null, size: number) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const batch = await read(after, BATCH);
    rows.push(...batch);
    const last = batch.at(-1);
    if (batch.length < BATCH || last === undefined) return rows;
    after = last.id;
  }
}
