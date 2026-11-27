import { describe, expect, it } from 'vitest';
import lock from './contract-lock.json' with { type: 'json' };
import { deactivatePersonCommandSchema } from './acl-commands.ts';
import { assistantResearchRefusalSchema } from './assistant-research.ts';
import { disablePersonAssistantCommandSchema } from './assistant-commands.ts';
import { platformCommandNameSchema } from './platform-commands.ts';
import { schemaRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './version.ts';

const personId = '00000000-0000-4000-8000-0000000000e2';
const requestId = '00000000-0000-4000-8000-0000000000e1';

describe('PA-20 an org admin turns off a person’s assistant', () => {
  it('names the person by id and nothing else', () => {
    const command = { command: 'disable_person_assistant', requestId, personId };
    expect(disablePersonAssistantCommandSchema.safeParse(command).success).toBe(true);
    expect(
      disablePersonAssistantCommandSchema.safeParse({ ...command, personId: 'ana' }).success,
    ).toBe(false);
    expect(
      disablePersonAssistantCommandSchema.safeParse({ ...command, name: 'barnabas' }).success,
    ).toBe(false);
    expect(platformCommandNameSchema.options).toContain('disable_person_assistant');
    expect(schemaRegistry['disable-person-assistant-command']).toBe(
      disablePersonAssistantCommandSchema,
    );
  });

  it('was published at 14.26.0 with the command name locked', () => {
    expect(lock.versions.map((version) => version.version)).toContain(CONTRACT_VERSION);
    const entry = lock.versions.find((version) => version.version === '14.26.0');
    const sets: Record<string, readonly string[]> = entry?.sets ?? {};
    expect(sets['platform-command-name']).toContain('disable_person_assistant');
  });
});

describe('PA-20 an org admin deactivates a leaver, and PA-19 a read needs an offered address', () => {
  it('names the person by id and nothing else', () => {
    const command = { command: 'deactivate_person', requestId, personId };
    expect(deactivatePersonCommandSchema.safeParse(command).success).toBe(true);
    expect(deactivatePersonCommandSchema.safeParse({ ...command, personId: 'ana' }).success).toBe(
      false,
    );
    expect(schemaRegistry['deactivate-person-command']).toBe(deactivatePersonCommandSchema);
  });

  it('is published at 14.27.0 with the command and the refusal locked', () => {
    expect(CONTRACT_VERSION).toBe('14.27.0');
    const entry = lock.versions.find((version) => version.version === '14.27.0');
    const sets: Record<string, readonly string[]> = entry?.sets ?? {};
    expect(sets['platform-command-name']).toContain('deactivate_person');
    expect(sets['assistant-research-refusal']).toContain('address_not_offered');
    expect(assistantResearchRefusalSchema.options).toContain('address_not_offered');
  });
});
