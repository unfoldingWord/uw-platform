import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';

const requestId = 'c8000000-0000-4000-8000-000000000001';
const check = 'c8000000-0000-4000-8000-000000000002';
const ship = 'c8000000-0000-4000-8000-000000000003';
const page = 'c8000000-0000-4000-8000-000000000004';

function stagesForm(): Record<string, string> {
  return {
    'stage.0.id': check,
    'stage.0.agentPickup': 'auto',
    'stage.0.exitGate': 'checks',
    'stage.0.wipLimit': '4',
    'stage.0.instructionsPageId': page,
    'stage.0.validator.lint': 'lint',
    'stage.0.validator.typecheck': 'typecheck',
    'stage.1.id': ship,
    'stage.1.agentPickup': 'none',
    'stage.1.exitGate': 'human_approval',
    'stage.1.wipLimit': '1',
    'stage.1.instructionsPageId': '',
  };
}

function gathersRows(): void {
  expect(commandBody('set_stage_rules', stagesForm(), requestId)).toEqual({
    command: 'set_stage_rules',
    requestId,
    stages: [
      {
        id: check,
        agentPickup: 'auto',
        exitGate: 'checks',
        wipLimit: 4,
        instructionsPageId: page,
        validators: ['lint', 'typecheck'],
      },
      {
        id: ship,
        agentPickup: 'none',
        exitGate: 'human_approval',
        wipLimit: 1,
        instructionsPageId: null,
        validators: [],
      },
    ],
  });
}

describe('#108 the Stages & controls forms become command bodies', () => {
  it('gathers each stage row, its page and its ticked checks into set_stage_rules', gathersRows);

  it('refuses a row whose limit is not a whole number of at least 1', () => {
    const form = { ...stagesForm(), 'stage.1.wipLimit': '0' };
    expect(commandBody('set_stage_rules', form, requestId)).toBeNull();
  });

  it('turns each switch on or off from its value', () => {
    expect(commandBody('set_shadow', { shadow: 'true' }, requestId)).toMatchObject({
      shadow: true,
    });
    expect(commandBody('set_hosted_builder', { enabled: 'false' }, requestId)).toMatchObject({
      enabled: false,
    });
    expect(commandBody('set_freeze', { frozen: 'true' }, requestId)).toMatchObject({
      frozen: true,
      allow: [],
    });
  });

  it('pauses and resumes one stage by key', () => {
    expect(commandBody('pause', { stageKey: 'build' }, requestId)).toMatchObject({
      command: 'pause',
      stageKey: 'build',
    });
    expect(commandBody('resume', { stageKey: 'build' }, requestId)).toMatchObject({
      stageKey: 'build',
    });
  });
});

describe('#110 the standing-permission forms become command bodies', () => {
  const delegationId = '00000000-0000-4000-8000-0000000000d1';

  it('grants a kind of work until the end of the chosen day', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: '2026-12-31' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toEqual({
      command: 'schedule_regular_tweak',
      requestId,
      persona: 'agent:reviewer',
      capability: 'review',
      expiresAt: '2026-12-31T23:59:59.000Z',
      supersedes: null,
      maxTier: null,
    });
  });

  it('leaves the end open when no day is chosen, and carries a merge tier', () => {
    const form = { grant: 'agent:merger|merge|low', expiresOn: '' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toMatchObject({
      expiresAt: null,
      maxTier: 'low',
    });
  });

  it('never sends a merge tier with work other than merge, whatever else the form holds', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: '', maxTier: 'low' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toMatchObject({
      capability: 'review',
      maxTier: null,
    });
  });

  it('refuses a day that is not a calendar date', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: 'soon' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toBeNull();
  });

  it('revokes one permission by id', () => {
    expect(commandBody('revoke_delegation', { delegationId }, requestId)).toEqual({
      command: 'revoke_delegation',
      requestId,
      delegationId,
    });
  });
});

const person = 'c8000000-0000-4000-8000-000000000009';

describe('#154 the Access command bodies', () => {
  it('grant_role names no area at org scope and one at an area, ending at the end of the chosen day', () => {
    const fields = { personId: person, role: 'viewer', scope: 'org', expiresOn: '' };
    expect(commandBody('grant_role', fields, requestId)).toEqual({
      command: 'grant_role',
      requestId,
      personId: person,
      role: 'viewer',
      scopeKind: 'org',
      scopeArea: null,
      expiresAt: null,
    });
    const area = { ...fields, role: 'editor', scope: '30-39', expiresOn: '2027-01-31' };
    expect(commandBody('grant_role', area, requestId)).toMatchObject({
      scopeKind: 'jd_area',
      scopeArea: '30-39',
      expiresAt: '2027-01-31T23:59:59.000Z',
    });
  });

  it('refuses a grant with no person or an unknown scope, and builds revoke and the two decisions', () => {
    const fields = { personId: '', role: 'viewer', scope: 'org' };
    expect(commandBody('grant_role', fields, requestId)).toBeNull();
    expect(
      commandBody('grant_role', { ...fields, personId: person, scope: 'x' }, requestId),
    ).toBeNull();
    expect(commandBody('revoke_role', { grantId: person }, requestId)).toEqual({
      command: 'revoke_role',
      requestId,
      grantId: person,
    });
    for (const command of ['approve_person', 'decline_person', 'deactivate_person']) {
      expect(commandBody(command, { personId: person }, requestId)).toEqual({
        command,
        requestId,
        personId: person,
      });
    }
  });
});

const credentialId = 'c1590000-0000-4000-8000-000000000001';
const owner = 'c1590000-0000-4000-8000-000000000002';
const workflow = 'c1590000-0000-4000-8000-000000000003';
const added = {
  jdArea: '20-29',
  jdRef: '',
  name: ' Bank export key ',
  kind: 'api_key',
  ownerId: owner,
  rotateBy: '',
  expiresOn: '',
  value: '  spaces kept \n',
};

describe('#159 the Credentials command bodies that carry a value', () => {
  it('create_credential trims the name, keeps the value as typed, and leaves empty dates and place as none', () => {
    expect(commandBody('create_credential', added, requestId)).toEqual({
      command: 'create_credential',
      requestId,
      jdArea: '20-29',
      jdRef: null,
      name: 'Bank export key',
      kind: 'api_key',
      ownerId: owner,
      rotateBy: null,
      expiresAt: null,
      value: '  spaces kept \n',
    });
    const dated = { ...added, jdRef: '28.04', rotateBy: '2027-02-01', expiresOn: '2027-03-01' };
    expect(commandBody('create_credential', dated, requestId)).toMatchObject({
      jdRef: '28.04',
      rotateBy: '2027-02-01',
      expiresAt: '2027-03-01T23:59:59.000Z',
    });
  });

  it('create_credential with no value, or rotate_credential with none, is not sent', () => {
    expect(commandBody('create_credential', { ...added, value: '' }, requestId)).toBeNull();
    const rotation = { credentialId, rotateBy: '', expiresOn: '', value: '' };
    expect(commandBody('rotate_credential', rotation, requestId)).toBeNull();
    expect(commandBody('rotate_credential', { ...rotation, value: 'next' }, requestId)).toEqual({
      command: 'rotate_credential',
      requestId,
      credentialId,
      rotateBy: null,
      expiresAt: null,
      value: 'next',
    });
  });
});

describe('#159 the Credentials command bodies that carry ids', () => {
  it('bind, unbind, revoke and the reveal grant commands carry ids and a whole number of minutes', () => {
    const binding = { credentialId, harnessId: workflow, connectorKey: 'send' };
    for (const command of ['bind_credential', 'unbind_credential']) {
      expect(commandBody(command, binding, requestId)).toEqual({ command, requestId, ...binding });
    }
    expect(commandBody('revoke_credential', { credentialId }, requestId)).toEqual({
      command: 'revoke_credential',
      requestId,
      credentialId,
    });
    const grant = { credentialId, personId: owner, minutes: '60' };
    expect(commandBody('grant_reveal', grant, requestId)).toEqual({
      command: 'grant_reveal',
      requestId,
      credentialId,
      personId: owner,
      minutes: 60,
    });
    expect(commandBody('grant_reveal', { ...grant, minutes: 'forever' }, requestId)).toBeNull();
    for (const command of ['confirm_reveal', 'revoke_reveal']) {
      expect(commandBody(command, { grantId: credentialId }, requestId)).toEqual({
        command,
        requestId,
        grantId: credentialId,
      });
    }
  });

  it('has no body for reveal_credential, which is never sent as a form command', () => {
    expect(commandBody('reveal_credential', { credentialId }, requestId)).toBeNull();
  });
});
