import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';
import { OUTCOME_TEXT } from './command-form.ts';

const requestId = 'f0000000-0000-4000-8000-000000000200';
const ada = 'a0000000-0000-4000-8000-000000000201';
const sam = 'a0000000-0000-4000-8000-000000000202';
const program = 'a0000000-0000-4000-8000-000000000203';

describe('#200 the team chart edit forms send the commitment and allocation commands', () => {
  it('#200 adds a commitment to a listed colleague, or to a name when no colleague is chosen', () => {
    expect(
      commandBody('add_commitment', { fromPersonId: ada, toPersonId: sam, toText: '' }, requestId),
    ).toEqual({
      command: 'add_commitment',
      requestId,
      fromPersonId: ada,
      toPersonId: sam,
      toText: null,
    });
    expect(
      commandBody(
        'add_commitment',
        { fromPersonId: ada, toPersonId: '', toText: ' Sam ' },
        requestId,
      ),
    ).toEqual({
      command: 'add_commitment',
      requestId,
      fromPersonId: ada,
      toPersonId: null,
      toText: 'Sam',
    });
  });

  it('#200 refuses to send a commitment naming both a colleague and a name, or neither', () => {
    expect(
      commandBody(
        'add_commitment',
        { fromPersonId: ada, toPersonId: sam, toText: 'Sam' },
        requestId,
      ),
    ).toBeNull();
    expect(
      commandBody('add_commitment', { fromPersonId: ada, toPersonId: '', toText: '' }, requestId),
    ).toBeNull();
  });
});

describe('#200 the staff allocation edit forms send the allocation commands', () => {
  it('#200 sets an allocation with a percent, or with none when the field is blank', () => {
    const given = { personId: ada, target: `program:${program}`, percent: '40' };
    expect(commandBody('set_staff_allocation', given, requestId)).toEqual({
      command: 'set_staff_allocation',
      requestId,
      personId: ada,
      target: { kind: 'program', pageId: program },
      percent: 40,
    });
    const blank = { ...given, target: `portfolio:${program}`, percent: ' ' };
    expect(commandBody('set_staff_allocation', blank, requestId)).toMatchObject({
      target: { kind: 'portfolio', pageId: program },
      percent: null,
    });
    expect(
      commandBody('set_staff_allocation', { ...given, percent: 'half' }, requestId),
    ).toBeNull();
  });

  it('#200 removes a commitment and an allocation, and says each outcome', () => {
    expect(commandBody('remove_commitment', { commitmentId: sam }, requestId)).toEqual({
      command: 'remove_commitment',
      requestId,
      commitmentId: sam,
    });
    expect(commandBody('remove_staff_allocation', { allocationId: sam }, requestId)).toEqual({
      command: 'remove_staff_allocation',
      requestId,
      allocationId: sam,
    });
    for (const name of [
      'add_commitment',
      'remove_commitment',
      'set_staff_allocation',
      'remove_staff_allocation',
    ]) {
      expect(OUTCOME_TEXT[name]).toBeTruthy();
    }
  });
});
