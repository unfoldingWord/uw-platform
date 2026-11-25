import {
  FORBIDDEN_VERBS,
  verbRegistry,
  type CapabilityWord,
  type Engine,
  type RunShape,
} from '@uw/contracts';
import type { ActivationCheckKey } from '@uw/harness';

export type ActionWords = {
  readonly name: string;
  readonly label: string;
  readonly detail: string;
};
export type ActionGroup = { readonly title: string; readonly actions: readonly ActionWords[] };

const action = (name: string, label: string, detail = ''): ActionWords => ({
  name,
  label,
  detail,
});

export const actionGroups: readonly ActionGroup[] = [
  {
    title: 'Pages and context',
    actions: [
      action('search_pages', 'Search pages', 'Find pages it may read.'),
      action('read_page', 'Read a page', 'One page it may read.'),
      action(
        'write_page',
        'Write or update a page',
        'Learning, skill and agent pages land as suggestions for a person to confirm.',
      ),
      action(
        'attach_file',
        'Attach a picture or file',
        'To a page it may edit, for the page to show.',
      ),
      action(
        'render_pdf',
        'Make a PDF',
        'Of a page, a saved view or a binder it may read, for a signed-in person to download.',
      ),
      action(
        'resolve_context',
        "Load an item's context",
        "The stage's instructions, the item's pages, and the learnings, policies and decisions that apply.",
      ),
    ],
  },
  {
    title: 'Records',
    actions: [
      action(
        'query_entities',
        'Run an approved records query',
        "Only named queries; rows it couldn't read directly never come back.",
      ),
    ],
  },
  {
    title: 'Work queue',
    actions: [
      action('poll_queue', 'See the work queue', 'Items it may take.'),
      action('claim_item', 'Claim an item', 'On a time-limited lease.'),
      action(
        'submit_to_gate',
        "Submit work for the stage's check",
        "The item then waits at the stage's exit rule.",
      ),
      action('record_run_step', 'Record what it did', 'Model, tokens and cost for each step.'),
    ],
  },
  { title: 'System', actions: [action('get_health', 'Read system health')] },
];

const notBuiltWords: Readonly<Record<string, string>> = {
  create_task: 'Create a task',
  list_gifts: 'List gifts',
  create_draft_journal_entry: 'Draft a journal entry',
};

const grouped = new Set(actionGroups.flatMap((group) => group.actions.map((entry) => entry.name)));

export function notBuiltActions(): readonly ActionWords[] {
  return verbRegistry
    .filter((verb) => !verb.servedInV1)
    .map((verb) => action(verb.name, notBuiltWords[verb.name] ?? verb.name));
}

export function otherServedActions(): readonly ActionWords[] {
  return verbRegistry
    .filter((verb) => verb.servedInV1 && !grouped.has(verb.name))
    .map((verb) => action(verb.name, verb.name, verb.summary));
}

export const lockedActions: readonly string[] = FORBIDDEN_VERBS;

export const runShapeWords: Readonly<Record<RunShape, string>> = {
  'workflow-run': 'The platform',
  'external-run': "People's own Claude Code",
};

const engineWords: Readonly<Record<Engine, string>> = {
  'openrouter-messages': 'Quick API call · OpenRouter',
  'claude-messages': 'Quick API call · Claude (Anthropic)',
  'claude-code-sandbox': 'Claude Code in a sandbox',
  'codex-sandbox': 'Codex in a sandbox',
  'claude-managed-agent': 'Managed agent · not available yet',
  external: "People's own Claude Code or Codex",
};

const capabilityWords: Readonly<Record<CapabilityWord, string>> = {
  none: 'No standing work',
  build: 'Build',
  review: 'Review',
  fix: 'Fix',
  iterate: 'Iterate',
  merge: 'Merge',
};

export const doesWords: Readonly<Record<CapabilityWord, string>> = {
  none: 'Works only when someone starts a run',
  build: 'Writes the code and opens the pull request',
  review: 'Reviews the pull request and posts findings',
  fix: 'Fixes the findings on a pull request',
  iterate: 'Reads the measurements and drafts a revision',
  merge: 'Merges low-risk changes',
};

export const checkWords: Readonly<Record<ActivationCheckKey, string>> = {
  actions_exist: 'Every action exists',
  nothing_forbidden: 'No forbidden action (approve, merge, deploy, publish, advance)',
  owner_permitted: 'The person putting it live may grant each of its actions',
  engine_available: 'Its engine is available',
  practice_run: 'A practice run passed',
};

function lookup<Key extends string>(record: Readonly<Record<Key, string>>) {
  const found: ReadonlyMap<string, string> = new Map(Object.entries(record));
  return (key: Key): string => found.get(key) ?? key;
}

export const runShapeWord = lookup(runShapeWords);
export const engineWord = lookup(engineWords);
export const capabilityWord = lookup(capabilityWords);
