import { describe, expect, it } from 'vitest';
import { screens } from './registry.ts';

describe('the screen registry', () => {
  it('names each screen once, by a file under the screens folder and a path', () => {
    const names = screens.map((screen) => screen.name);
    expect(new Set(names).size).toBe(names.length);
    for (const screen of screens) {
      expect(screen.file).toBe(`apps/uw-app/views/screens/${screen.name}.tsx`);
      expect(screen.path.startsWith('/')).toBe(true);
    }
  });
});
