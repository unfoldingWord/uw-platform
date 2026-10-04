import { principalSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { hubHeaders } from './connect.ts';

const personId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000c1';

function principal(kind: 'person' | 'agent') {
  return principalSchema.parse({
    identity: kind === 'person' ? `human:${personId}` : `agent:${personId}/laptop`,
    kind,
    personId,
    email: kind === 'person' ? 'ana@example.org' : null,
    grants: [],
    interactive: true,
  });
}

describe('the hub learns the screen only from a person session', () => {
  it('names the screen and item for a person', () => {
    expect(hubHeaders(principal('person'), personId, { screen: 'item', item: itemId })).toEqual({
      Upgrade: 'websocket',
      'x-hub-person': personId,
      'x-hub-screen': 'item',
      'x-hub-item': itemId,
    });
  });

  it('never names a screen for an agent, so an agent session is never presence', () => {
    expect(hubHeaders(principal('agent'), personId, { screen: 'gates', item: null })).toEqual({
      Upgrade: 'websocket',
      'x-hub-person': personId,
    });
  });
});
