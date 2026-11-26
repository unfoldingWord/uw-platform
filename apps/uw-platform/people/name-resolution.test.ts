import { describe, expect, it } from 'vitest';
import { nameIndex, resolveTarget, type NamedPerson } from './name-resolution.ts';

const ada: NamedPerson = { id: '00000000-0000-4000-8000-000000200a01', name: 'Ada Example' };
const sam: NamedPerson = { id: '00000000-0000-4000-8000-000000200a02', name: 'Sam Sample' };
const samTwo: NamedPerson = { id: '00000000-0000-4000-8000-000000200a03', name: 'Sam Specimen' };
const lee: NamedPerson = {
  id: '00000000-0000-4000-8000-000000200a04',
  name: 'Lee-Anne Placeholder',
};
const index = nameIndex([ada, sam, samTwo, lee]);

const byText = (toText: string) => resolveTarget(index, { toPersonId: null, toText });

describe('#200 a commitment target resolves exactly, or is left out and reported, never guessed', () => {
  it('#200 an entry naming a person by id resolves to exactly that person', () => {
    expect(resolveTarget(index, { toPersonId: sam.id, toText: null })).toEqual({
      kind: 'resolved',
      person: sam,
      by: 'id',
    });
  });

  it('#200 an entry naming an id the reader cannot read is not readable, not a guess', () => {
    const hidden = { toPersonId: '00000000-0000-4000-8000-000000200aff', toText: null };
    expect(resolveTarget(index, hidden)).toEqual({ kind: 'not_readable' });
  });

  it('#200 a text entry resolves by exact full name, ignoring case and spacing', () => {
    expect(byText('  ada   EXAMPLE ')).toEqual({ kind: 'resolved', person: ada, by: 'full_name' });
  });

  it('#200 a text entry resolves by a loose name with its punctuation flattened', () => {
    expect(byText('lee.anne placeholder')).toEqual({
      kind: 'resolved',
      person: lee,
      by: 'loose_name',
    });
    expect(byText('Ada_Example')).toEqual({ kind: 'resolved', person: ada, by: 'loose_name' });
  });

  it('#200 a text entry resolves by a first name only when exactly one person has it', () => {
    expect(byText('ada')).toEqual({ kind: 'resolved', person: ada, by: 'first_name' });
  });

  it('#200 two or more candidates make the entry ambiguous, with every candidate named', () => {
    expect(byText('Sam')).toEqual({ kind: 'ambiguous', candidates: [sam, samTwo] });
  });

  it('#200 a full name shared by two people is ambiguous, not the first one found', () => {
    const twins = nameIndex([ada, { ...sam, name: 'Ada Example' }]);
    expect(resolveTarget(twins, { toPersonId: null, toText: 'Ada Example' })).toEqual({
      kind: 'ambiguous',
      candidates: [ada, { ...sam, name: 'Ada Example' }],
    });
  });

  it('#200 a name nobody has, or a first name with a wrong surname, is unresolved', () => {
    expect(byText('Quinn Nobody')).toEqual({ kind: 'unresolved' });
    expect(byText('Ada Wrongname')).toEqual({ kind: 'unresolved' });
    expect(byText('---')).toEqual({ kind: 'unresolved' });
  });
});
