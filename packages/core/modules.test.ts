import { describe, expect, it } from 'vitest';
import { moduleSchema, modules } from './modules.ts';

const keys = modules.map((declared) => declared.key);

describe('the module registry', () => {
  it('declares core and agents', () => {
    expect(keys).toEqual(['core', 'agents']);
  });

  it.each(modules)('declares $key in the plan §14 shape', (declared) => {
    expect(moduleSchema.parse(declared)).toEqual(declared);
  });

  it('has unique keys', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('depends only on declared modules', () => {
    const undeclared = modules.flatMap((declared) =>
      declared.depends_on.filter((dependency) => !keys.includes(dependency)),
    );
    expect(undeclared).toEqual([]);
  });

  it('declares each module after everything it depends on', () => {
    const outOfOrder = modules.filter((declared, position) =>
      declared.depends_on.some((dependency) => keys.indexOf(dependency) >= position),
    );
    expect(outOfOrder).toEqual([]);
  });

  it('lets no two modules claim the same table', () => {
    const tables = modules.flatMap((declared) => [...declared.tables]);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('refuses a module outside the §14 shape', () => {
    expect(moduleSchema.safeParse({ key: 'core', name: 'Core' }).success).toBe(false);
  });
});
