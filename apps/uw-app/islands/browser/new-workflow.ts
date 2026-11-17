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

async function create(form: HTMLFormElement, deps: NewWorkflowDeps): Promise<boolean> {
  const harnessId = deps.uuid();
  const body = bodyOf(form, deps.uuid());
  if (!harnessCommandSchemas.activate_template.safeParse(body).success) {
    setOutcome(form, checkWords);
    return false;
  }
  const made = await post(deps, harnessId, body);
  if (made.status !== 'accepted') {
    setOutcome(form, refusalWords.get(made.reason) ?? reasonText(made.reason));
    return false;
  }
  await post(deps, harnessId, { command: 'open_workflow_draft', requestId: deps.uuid() });
  deps.go(`/harnesses/${encodeURIComponent(harnessId)}`);
  return true;
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
