import { gateViewSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import shipReady from '../../../../packages/contracts/fixtures/gate-view/valid/ship-ready.json' with { type: 'json' };
import { ShipInput } from './ship-input.tsx';

const ready = gateViewSchema.parse(shipReady);

function shown(reasons: readonly string[] | null): string {
  const ship = ready.ship;
  if (ship === null) throw new TypeError('the fixture is not at a ship stage');
  const outcome = reasons === null ? ship.outcome : { verdict: 'refuse', reasons };
  const view = gateViewSchema.parse({ ...ready, ship: { ...ship, outcome } });
  return String(ShipInput({ view }));
}

describe('GD-1 the ship rule inputs name a gate behind its base', () => {
  it('GD-1 says the gate is waiting for a base update when the rule refuses base_behind', () => {
    expect(shown(['base_behind'])).toContain('Waiting for a base update');
    expect(shown(['no_reviewer_approval'])).not.toContain('Waiting for a base update');
    expect(shown(null)).not.toContain('Waiting for a base update');
  });
});
