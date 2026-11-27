import { describe, expect, it } from 'vitest';
import {
  assistantAccountStatusSchema,
  assistantAddressOf,
  assistantJdIdSchema,
  assistantNameRefusal,
  assistantProvisioningFailureSchema,
  assistantProvisioningStepSchema,
  disableAssistantCommandSchema,
  enableAssistantCommandSchema,
  grantAssistCommandSchema,
  nextAssistantJdId,
} from './assistant-accounts.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { assistantProvisionerIdentity, identitySchema, personaSlugSchema } from './identity.ts';
import { errorReasonSchema } from './outcomes.ts';

const requestId = '00000000-0000-4000-8000-0000000000e1';

describe('PA-14 the assistant name', () => {
  it('takes lowercase letters, digits, dots and hyphens, two to thirty characters', () => {
    for (const name of ['barnabas', 'ana-maria', 'j.doe', 'b2', 'a'.repeat(30)]) {
      expect(assistantNameRefusal(name)).toBeNull();
    }
    for (const name of [
      'b',
      'a'.repeat(31),
      'Barnabas',
      'bar nabas',
      '.bar',
      'bar-',
      'a..b',
      'bar_b',
    ]) {
      expect(assistantNameRefusal(name)).toBe('name_invalid');
    }
  });

  it('refuses the reserved mailbox names', () => {
    for (const name of ['admin', 'postmaster', 'abuse', 'noreply', 'assistant', 'unfoldingword']) {
      expect(assistantNameRefusal(name)).toBe('name_reserved');
    }
  });

  it('makes the address the name exactly, with no suffix', () => {
    expect(assistantAddressOf('barnabas', 'unfoldingword.org')).toBe('barnabas@unfoldingword.org');
  });
});

describe('PA-14 the assistant JD id', () => {
  it('runs from 10.51 to 10.99 and then 10.100 upward', () => {
    for (const id of ['10.51', '10.99', '10.100', '10.999']) {
      expect(assistantJdIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of ['10.50', '10.05', '11.51', '10.1000', '10.051']) {
      expect(assistantJdIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('allocates the lowest free id from 10.51, whatever pages and assistants hold', () => {
    expect(nextAssistantJdId([])).toBe('10.51');
    expect(nextAssistantJdId(['10.51', '10.53', '10.01', '20.52'])).toBe('10.52');
    const full = Array.from({ length: 49 }, (_, n) => `10.${String(51 + n)}`);
    expect(nextAssistantJdId(full)).toBe('10.100');
    expect(nextAssistantJdId([...full, '10.100'])).toBe('10.101');
  });
});

describe('PA-14 the account contracts', () => {
  it('closes the statuses, the provisioning steps and their failures', () => {
    expect([...assistantAccountStatusSchema.options]).toEqual(['enabled', 'disabled', 'deleted']);
    expect([...assistantProvisioningStepSchema.options]).toEqual([
      'workspace_user',
      'zulip_bot',
      'persona',
      'assist',
      'suspend_user',
      'deactivate_bot',
      'delete_user',
    ]);
    expect(assistantProvisioningFailureSchema.safeParse('name_taken').success).toBe(true);
    expect(errorReasonSchema.safeParse('assistant_name_taken').success).toBe(true);
  });

  it('names the account events and keeps their evidence to ids and closed values', () => {
    for (const name of [
      'assistant_enabled',
      'assistant_disabled',
      'assistant_provisioned',
      'assistant_provisioning_failed',
      'assistant_deleted',
    ]) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
    const enabled = eventEvidenceSchemas.assistant_enabled;
    expect(enabled.safeParse({ jdId: '10.51', restored: false }).success).toBe(true);
    expect(enabled.safeParse({ jdId: '10.51', restored: false, name: 'b' }).success).toBe(false);
    const failed = eventEvidenceSchemas.assistant_provisioning_failed;
    expect(failed.safeParse({ step: 'workspace_user', why: 'name_taken' }).success).toBe(true);
    expect(failed.safeParse({ step: 'workspace_user', why: 'boom' }).success).toBe(false);
    expect(eventEvidenceSchemas.assistant_deleted.safeParse({ jdId: '10.52' }).success).toBe(true);
  });

  it('carries the person commands', () => {
    const enable = { command: 'enable_assistant', requestId, name: 'barnabas' };
    expect(enableAssistantCommandSchema.safeParse(enable).success).toBe(true);
    expect(enableAssistantCommandSchema.safeParse({ ...enable, personId: requestId }).success).toBe(
      false,
    );
    const disable = { command: 'disable_assistant', requestId };
    expect(disableAssistantCommandSchema.safeParse(disable).success).toBe(true);
    const grant = { command: 'grant_assist', requestId, expiresAt: null };
    expect(grantAssistCommandSchema.safeParse(grant).success).toBe(true);
  });

  it('names the provisioner as a platform identity no persona can take', () => {
    expect(identitySchema.safeParse(assistantProvisionerIdentity).success).toBe(true);
    expect(personaSlugSchema.safeParse('assistant-provisioner').success).toBe(false);
  });
});
