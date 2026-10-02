import { describe, expect, it } from 'vitest';
import { findVerb, verbRegistry } from '@uw/contracts';
import { verbHandlers } from './index.ts';

const served = verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);

describe('every served verb has exactly one handler and nothing else has one', () => {
  it('has a handler for each served verb and for nothing else', () => {
    expect([...verbHandlers.keys()].sort()).toEqual([...served].sort());
  });

  it('registers each handler under its own name', () => {
    for (const [name, handler] of verbHandlers) expect(handler.name).toBe(name);
  });
});

describe('the gated handlers are exactly the verbs whose registry grant is not null', () => {
  it('gates each verb with a grant and only those', () => {
    for (const [name, handler] of verbHandlers) {
      expect({ name, gated: handler.kind === 'gated' }).toEqual({
        name,
        gated: findVerb(name)?.grant !== null,
      });
    }
  });
});
