import { describe, expect, it } from 'vitest';
import { principalSchema, type Grant } from '@uw/contracts';
import { agentClaimOf, mayMint, mintAgent } from './mint.ts';

const OWNER = '00000000-0000-4000-8000-000000000901';
const DELEGATION = '00000000-0000-4000-8000-000000000903';
const at = new Date('2026-10-02T12:00:00.000Z');

function grant(role: Grant['role'], expiresAt: string | null = null, n = 1): Grant {
  return {
    grantId: `00000000-0000-4000-8000-00000000091${n}`,
    role,
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    expiresAt,
  };
}

const orgAdmin: Grant = {
  grantId: '00000000-0000-4000-8000-000000000919',
  role: 'admin',
  scopeKind: 'org',
  scopeArea: null,
  expiresAt: null,
};

function headersOf(values: Record<string, string>): (name: string) => string | undefined {
  const map = new Map(Object.entries(values));
  return (name) => map.get(name);
}

const owner = { personId: OWNER, grants: [grant('editor'), orgAdmin] };

describe("AB-2 an agent identity is minted under its owner with exactly the owner's grants", () => {
  it("mints agent:<person>/<device> as an agent with the owner's grants", () => {
    const minted = mintAgent(owner, 'laptop', null, true);
    expect(minted.identity).toBe(`agent:${OWNER}/laptop`);
    expect(minted.kind).toBe('agent');
    expect(minted.personId).toBe(OWNER);
    expect(minted.email).toBeNull();
    expect(minted.grants).toEqual(owner.grants);
    expect(minted.interactive).toBe(true);
    expect(mintAgent(owner, 'laptop', null, false).interactive).toBe(false);
    expect(principalSchema.safeParse(minted).success).toBe(true);
  });

  it('mints the delegated form when a delegation is named', () => {
    const minted = mintAgent(
      owner,
      'laptop',
      { personaSlug: 'iterate', delegationId: DELEGATION },
      true,
    );
    expect(minted.identity).toBe(`agent:${OWNER}/laptop as iterate via delegation:${DELEGATION}`);
    expect(minted.personId).toBe(OWNER);
  });

  it('copies the grants rather than sharing the owner array', () => {
    const minted = mintAgent(owner, 'laptop', null, true);
    expect(minted.grants).not.toBe(owner.grants);
  });

  it('refuses a device that breaks the device rule', () => {
    expect(() => mintAgent(owner, 'Laptop', null, true)).toThrow();
  });

  it('allows editor or admin at any scope, and refuses viewer only or an expired editor', () => {
    expect(mayMint([grant('editor')], at)).toBe(true);
    expect(mayMint([grant('admin')], at)).toBe(true);
    expect(mayMint([orgAdmin], at)).toBe(true);
    expect(mayMint([grant('editor', '2026-10-03T00:00:00.000Z')], at)).toBe(true);
    expect(mayMint([grant('viewer')], at)).toBe(false);
    expect(mayMint([], at)).toBe(false);
    expect(mayMint([grant('editor', '2026-10-02T06:00:00.000Z')], at)).toBe(false);
    expect(mayMint([grant('editor', at.toISOString())], at)).toBe(false);
    expect(mayMint([grant('viewer'), grant('admin', null, 2)], at)).toBe(true);
  });
});

describe('AB-6 a runner names its persona and delegation together or not at all', () => {
  it('reads no claim when no agent header is sent', () => {
    expect(agentClaimOf(headersOf({}))).toEqual({ device: null, delegation: null });
  });

  it('reads the device, and the persona with its delegation', () => {
    expect(agentClaimOf(headersOf({ 'x-uw-device': 'laptop' }))).toEqual({
      device: 'laptop',
      delegation: null,
    });
    const claim = agentClaimOf(
      headersOf({
        'x-uw-device': 'laptop',
        'x-uw-persona': 'iterate',
        'x-uw-delegation': DELEGATION,
      }),
    );
    expect(claim).toEqual({
      device: 'laptop',
      delegation: { personaSlug: 'iterate', delegationId: DELEGATION },
    });
  });

  it('refuses a persona without its delegation, and a delegation without its persona', () => {
    expect(agentClaimOf(headersOf({ 'x-uw-persona': 'iterate' }))).toBeNull();
    expect(agentClaimOf(headersOf({ 'x-uw-delegation': DELEGATION }))).toBeNull();
  });

  it('refuses a device that breaks the device rule', () => {
    for (const device of ['Laptop', '', '-laptop', 'lap top', 'a'.repeat(33), 'lap/top']) {
      expect(agentClaimOf(headersOf({ 'x-uw-device': device }))).toBeNull();
    }
  });

  it('refuses a malformed persona slug, a reserved slug, and a delegation that is not a uuid', () => {
    const pair = (persona: string, delegation: string) =>
      agentClaimOf(headersOf({ 'x-uw-persona': persona, 'x-uw-delegation': delegation }));
    expect(pair('Iterate', DELEGATION)).toBeNull();
    expect(pair('system', DELEGATION)).toBeNull();
    expect(pair('ingest', DELEGATION)).toBeNull();
    expect(pair('iterate', 'not-a-uuid')).toBeNull();
    expect(pair('iterate', '')).toBeNull();
  });
});
