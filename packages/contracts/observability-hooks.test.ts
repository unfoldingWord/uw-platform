import { expect, it } from 'vitest';
import { commandSchema } from './commands.ts';
import * as closedSets from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { botAuthorsSchema, defaultBotAuthors, harnessSchema, itemStateSchema } from './harness.ts';
import { deepLinkSchema, healthLink } from './notify.ts';
import { errorReasonSchema } from './outcomes.ts';
import { learningFrontmatterSchema } from './page-types.ts';

const requestId = '00000000-0000-4000-8000-0000000000aa';
const harness = {
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'tc-admin-app',
  template: 'check-only',
  jdArea: '80-89',
  repository: 'unfoldingWord/tc-admin-app',
  hostedBuilderEnabled: false,
  paused: false,
};
const item = {
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: harness.id,
  stageKey: 'check',
  title: 'Bump the lockfile',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
};
const learning = { confidence: 'observed', as_of: '2026-10-15', supersedes: [], review_by: null };

it('OB-1 ranks the silence alarm among the wake reasons and links its drill-through', () => {
  expect(closedSets.wakeReasonSchema.options).toContain('silence_alarm');
  expect(healthLink('silence_alarm')).toBe('/health/silence_alarm');
  expect(deepLinkSchema.safeParse('/health/Silence').success).toBe(false);
  expect(deepLinkSchema.safeParse('/health/silence_alarm/more').success).toBe(false);
  const red = {
    level: 'red',
    waiting: 2,
    oldestEnteredAt: '2026-10-15T07:00:00.000Z',
    lastReviewStepAt: null,
  };
  expect(eventEvidenceSchemas.silence_alarm.safeParse(red).success).toBe(true);
  expect(eventEvidenceSchemas.silence_alarm.safeParse({ ...red, level: 'amber' }).success).toBe(
    false,
  );
  expect(eventEvidenceSchemas.silence_alarm.safeParse({ ...red, waiting: 0 }).success).toBe(false);
});

it('OB-2 an item carries when its holder took the ball, null for an item folded before it', () => {
  expect(itemStateSchema.parse(item).heldSince).toBeNull();
  const held = { ...item, heldSince: '2026-10-15T08:00:00.000Z' };
  expect(itemStateSchema.parse(held).heldSince).toBe('2026-10-15T08:00:00.000Z');
  expect(itemStateSchema.safeParse({ ...item, heldSince: 'yesterday' }).success).toBe(false);
});

it('OB-4 a harness lists dependabot as a bot author unless told otherwise', () => {
  expect(defaultBotAuthors).toEqual(['dependabot[bot]']);
  expect(harnessSchema.parse(harness).botAuthors).toEqual(['dependabot[bot]']);
  expect(harnessSchema.parse({ ...harness, botAuthors: [] }).botAuthors).toEqual([]);
  expect(botAuthorsSchema.safeParse(['renovate[bot]', 'Renovate[bot]']).success).toBe(false);
  expect(botAuthorsSchema.safeParse(Array.from({ length: 21 }, (_, n) => `bot${n}`)).success).toBe(
    false,
  );
  const activation = {
    command: 'activate_template',
    requestId,
    harnessKey: 'tc-admin-app',
    jdArea: '80-89',
    template: 'check-only',
    repository: 'unfoldingWord/tc-admin-app',
  };
  const parsed = commandSchema.parse(activation);
  expect(parsed.command === 'activate_template' ? parsed.botAuthors : null).toEqual([
    'dependabot[bot]',
  ]);
});

it('PI-2 a learning names its source and the pull request it came from, platform by default', () => {
  expect(closedSets.learningSourceSchema.options).toEqual(['platform', 'external']);
  expect(learningFrontmatterSchema.parse(learning)).toMatchObject({
    source: 'platform',
    pull_request: null,
  });
  const external = {
    ...learning,
    source: 'external',
    pull_request: { repo: 'unfoldingWord/tc-admin-app', number: 7 },
  };
  expect(learningFrontmatterSchema.safeParse(external).success).toBe(true);
  expect(learningFrontmatterSchema.safeParse({ ...learning, source: 'bench' }).success).toBe(false);
});

it('GL-5 changes a template by command and refuses with its own reason', () => {
  const change = { command: 'change_template', requestId, template: 'software' };
  expect(commandSchema.safeParse(change).success).toBe(true);
  expect(commandSchema.safeParse({ ...change, template: 'kanban' }).success).toBe(false);
  expect(errorReasonSchema.options).toContain('template_change_not_allowed');
  const changed = {
    from: 'check-only',
    to: 'software',
    kept: ['check', 'ship'],
    added: ['package'],
  };
  expect(eventEvidenceSchemas.template_changed.safeParse(changed).success).toBe(true);
  expect(eventEvidenceSchemas.template_changed.safeParse({ ...changed, added: [] }).success).toBe(
    false,
  );
});
