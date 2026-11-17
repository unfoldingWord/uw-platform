import { harnessCommandSchemas } from '@uw/contracts';
import { reasonText } from '@uw/ui/components/text.ts';
import { answerOf, goBusy, setOutcome, settle } from './command-form.ts';

type NewWorkflowDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly go: (href: string) => void;
};

const KEY_LIMIT = 60;

const refusalWords: ReadonlyMap<string, string> = new Map([
  ['harness_exists', 'A workflow with this name or repository already exists.'],
  ['not_permitted', 'You’re not an admin of that area.'],
]);

const checkWords = 'Check the name, and give the repository as owner/name.';
const unsureWords =
  'We couldn’t tell whether the workflow was created. Press Create again to check; it won’t make a second one.';

const ambiguous: ReadonlySet<string> = new Set(['internal_error', 'request_in_flight']);

type Pending = {
  readonly harnessId: string;
  readonly body: Readonly<Record<string, unknown>>;
  created: boolean;
  openRequestId: string | null;
};

const pendingByForm = new WeakMap<HTMLFormElement, Pending>();

export function workflowKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, KEY_LIMIT)
    .replace(/^-+|-+$/g, '');
}

function valueOf(form: HTMLFormElement, selector: string): string {
  const control = form.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  return control?.value.trim() ?? '';
}

function bodyOf(form: HTMLFormElement, requestId: string): Readonly<Record<string, unknown>> {
  const title = valueOf(form, '[name="title"]');
  const repository = valueOf(form, '[name="repository"]');
  return {
    command: 'activate_template',
    requestId,
    harnessKey: workflowKey(title),
    title,
    jdArea: valueOf(form, '[name="jdArea"]'),
    template: valueOf(form, '[name="template"]:checked'),
    repository: repository === '' ? null : repository,
  };
}

function post(deps: NewWorkflowDeps, harnessId: string, body: Readonly<Record<string, unknown>>) {
  const command = String(body['command']);
  return deps
    .fetch(`/api/harness/${encodeURIComponent(harnessId)}/commands/${command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .then(answerOf)
    .catch(() => ({ status: 'error', reason: 'internal_error' }));
}

function lockFields(form: HTMLFormElement, locked: boolean): void {
  for (const control of form.querySelectorAll('input, select, textarea')) {
    control.toggleAttribute('disabled', locked);
  }
}

function flowOf(pending: Pending): string {
  return `/harnesses/${encodeURIComponent(pending.harnessId)}`;
}

function showUnopened(form: HTMLFormElement, pending: Pending, reason: string): void {
  const why = refusalWords.get(reason) ?? reasonText(reason);
  setOutcome(
    form,
    `Your workflow was created, but its draft didn’t open (${why}). Press Create again to try once more, or `,
  );
  const link = form.ownerDocument.createElement('a');
  link.href = flowOf(pending);
  link.textContent = 'open its Flow tab';
  form.querySelector('[data-outcome]')?.append(link, '.');
}

function startPending(form: HTMLFormElement, deps: NewWorkflowDeps): Pending | null {
  const harnessId = deps.uuid();
  const body = bodyOf(form, deps.uuid());
  if (!harnessCommandSchemas.activate_template.safeParse(body).success) return null;
  const pending = { harnessId, body, created: false, openRequestId: null };
  pendingByForm.set(form, pending);
  return pending;
}

async function activate(
  form: HTMLFormElement,
  pending: Pending,
  deps: NewWorkflowDeps,
): Promise<boolean> {
  const made = await post(deps, pending.harnessId, pending.body);
  if (made.status === 'accepted') {
    pending.created = true;
    return true;
  }
  if (ambiguous.has(made.reason)) {
    lockFields(form, true);
    setOutcome(form, unsureWords);
    return false;
  }
  pendingByForm.delete(form);
  lockFields(form, false);
  setOutcome(form, refusalWords.get(made.reason) ?? reasonText(made.reason));
  return false;
}

async function openDraft(
  form: HTMLFormElement,
  pending: Pending,
  deps: NewWorkflowDeps,
): Promise<boolean> {
  pending.openRequestId ??= deps.uuid();
  const body = { command: 'open_workflow_draft', requestId: pending.openRequestId };
  const opened = await post(deps, pending.harnessId, body);
  if (opened.status === 'accepted') {
    pendingByForm.delete(form);
    deps.go(flowOf(pending));
    return true;
  }
  if (!ambiguous.has(opened.reason)) pending.openRequestId = null;
  lockFields(form, true);
  showUnopened(form, pending, opened.reason);
  return false;
}

async function create(form: HTMLFormElement, deps: NewWorkflowDeps): Promise<boolean> {
  const pending = pendingByForm.get(form) ?? startPending(form, deps);
  if (pending === null) {
    setOutcome(form, checkWords);
    return false;
  }
  if (!pending.created && !(await activate(form, pending, deps))) return false;
  return openDraft(form, pending, deps);
}

async function onSubmit(event: Event, deps: NewWorkflowDeps): Promise<void> {
  const target = event.target as Element | null;
  if (target?.tagName !== 'FORM' || !target.hasAttribute('data-new-workflow')) return;
  event.preventDefault();
  const form = target as HTMLFormElement;
  if (form.hasAttribute('aria-busy')) return;
  const quieted = goBusy(form);
  const made = await create(form, deps);
  settle(form, quieted, made);
}

export function wireNewWorkflow(root: Document | Element, deps: NewWorkflowDeps): void {
  root.addEventListener('submit', (event) => void onSubmit(event, deps));
}
