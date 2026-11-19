import { describe, expect, it } from 'vitest';
import {
  personaFrontmatterSchema,
  principalSchema,
  type Principal,
  type Role,
} from '@uw/contracts';
import { activationChecks, type CheckInput } from './checks.ts';

const at = new Date('2026-11-17T09:00:00.000Z');
const personId = '00000000-0000-4000-8000-000000000102';

const body = [
  '---',
  'name: reviewer',
  'description: Reviews the pull request.',
  '---',
  'Read the diff and post findings.',
].join('\n');

const frontmatter = personaFrontmatterSchema.parse({
  identity: 'agent:reviewer',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'poll_queue'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3',
  provider: 'z-ai',
  budget: { monthly_minor: 3000, currency: 'USD' },
  capability: 'review',
});

function personWith(role: Role): Principal {
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: 'person2@unfoldingword.org',
    grants: [
      {
        grantId: '00000000-0000-4000-8000-000000020200',
        role,
        scopeKind: 'jd_area',
        scopeArea: '80-89',
        expiresAt: null,
      },
    ],
    interactive: true,
  });
}

function input(change: Partial<typeof frontmatter> = {}, text = body): CheckInput {
  return {
    frontmatter: { ...frontmatter, ...change },
    body: text,
    activator: personWith('admin'),
    area: '80-89',
    at,
  };
}

function verdicts(checks: Awaited<ReturnType<typeof activationChecks>>) {
  return Object.fromEntries(checks.map((check) => [check.key, check.passed]));
}

describe('activationChecks reports all five activation checks at once, without writing', () => {
  it('passes every check for a sound persona and an admin activator', async () => {
    expect(verdicts(await activationChecks(input()))).toEqual({
      actions_exist: true,
      nothing_forbidden: true,
      owner_permitted: true,
      engine_available: true,
      practice_run: true,
    });
  });

  it('fails only the check that a forbidden action breaks, and names it', async () => {
    const checks = await activationChecks(input({ toolset: ['read_page', 'approve'] }));
    expect(verdicts(checks)).toMatchObject({ actions_exist: true, nothing_forbidden: false });
    expect(checks.find((check) => check.key === 'nothing_forbidden')?.verb).toBe('approve');
  });

  it('fails actions_exist for an action no module serves yet', async () => {
    const checks = await activationChecks(input({ toolset: ['read_page', 'list_gifts'] }));
    expect(verdicts(checks)).toMatchObject({ actions_exist: false, nothing_forbidden: true });
  });

  it('fails engine_available for a reserved engine', async () => {
    const checks = await activationChecks(input({ engine: 'claude-managed-agent' }));
    expect(verdicts(checks)).toMatchObject({ engine_available: false });
  });

  it('fails the practice run when the instructions name another agent', async () => {
    const checks = await activationChecks(input({}, body.replace('name: reviewer', 'name: other')));
    expect(verdicts(checks)).toMatchObject({ practice_run: false });
  });

  it('leaves owner_permitted unknown when nobody who could activate it is looking', async () => {
    const checks = await activationChecks({ ...input(), activator: null });
    expect(verdicts(checks)).toMatchObject({ owner_permitted: null, actions_exist: true });
  });
});
