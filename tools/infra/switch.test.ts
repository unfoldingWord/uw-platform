import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSwitch } from './switch.ts';

describe('GL-1 the runbook switches on what the go-live files leave unset', () => {
  it('GL-1 the switch is a boolean in infra/go-live.json and nothing else', () => {
    expect(parseSwitch('{ "switchedOn": false }')).toBe(false);
    expect(parseSwitch('{ "switchedOn": true }')).toBe(true);
    expect(() => parseSwitch('{ "switchedOn": "yes" }')).toThrow('infra/go-live.json');
    expect(() => parseSwitch('{}')).toThrow('infra/go-live.json');
    expect(typeof parseSwitch(readFileSync('infra/go-live.json', 'utf8'))).toBe('boolean');
  });
});
