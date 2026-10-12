import journal from './migrations/meta/_journal.json' with { type: 'json' };

export const migrationTimestamps: readonly number[] = journal.entries.map((entry) => entry.when);
