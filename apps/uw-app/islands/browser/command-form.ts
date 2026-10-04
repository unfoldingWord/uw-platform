import { harnessCommandSchemas } from '@uw/contracts';
import { reasonText } from '@uw/ui/components/text.ts';

export type CommandFields = Readonly<Record<string, string>>;

type CommandDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly afterAccepted: () => void;
};

export const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  enqueue: 'Added to the first stage',
  reorder: 'Moved',
  claim: 'You hold this item now',
  release: 'Released',
  approve: 'Approved',
  reject: 'Rejected',
  take_over: 'You hold this item now',
  override: 'Overridden',
};

const outcomes: ReadonlyMap<string, string> = new Map(Object.entries(OUTCOME_TEXT));
const schemas = new Map(Object.entries(harnessCommandSchemas));
const fields = (all: CommandFields) => new Map(Object.entries(all));
const optional = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

function findingsOf(text: string | undefined): readonly string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

type Shape = (given: ReadonlyMap<string, string>) => Readonly<Record<string, unknown>>;

const itemOnly: Shape = (given) => ({ itemId: given.get('itemId') });

const shapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['enqueue', (given) => ({ title: given.get('title'), pageId: null, due: null })],
  [
    'reorder',
    (given) => ({ itemId: given.get('itemId'), beforeItemId: optional(given.get('beforeItemId')) }),
  ],
  ['claim', itemOnly],
  ['release', itemOnly],
  ['take_over', itemOnly],
  ['approve', (given) => ({ itemId: given.get('itemId'), head: optional(given.get('head')) })],
  [
    'reject',
    (given) => ({ itemId: given.get('itemId'), findings: findingsOf(given.get('findings')) }),
  ],
  [
    'override',
    (given) => ({
      itemId: given.get('itemId'),
      head: optional(given.get('head')),
      reason: given.get('reason'),
    }),
  ],
]);

export function commandBody(
  command: string,
  given: CommandFields,
  requestId: string,
): Readonly<Record<string, unknown>> | null {
  const shape = shapes.get(command);
  const schema = schemas.get(command);
  if (shape === undefined || schema === undefined) return null;
  const body = { command, requestId, ...shape(fields(given)) };
  return schema.safeParse(body).success ? body : null;
}

type Control = Element & { readonly value: string; readonly checked?: boolean };

function counted(control: Control): boolean {
  const type = control.getAttribute('type');
  if (type === 'checkbox' || type === 'radio') return control.checked === true;
  return !control.hasAttribute('disabled');
}

function formFields(form: HTMLFormElement): CommandFields {
  const controls = [...form.querySelectorAll<Control>('input[name], textarea[name], select[name]')];
  const entries = controls
    .filter(counted)
    .map((control) => [control.getAttribute('name') ?? '', control.value] as const);
  return Object.fromEntries(entries);
}

function commandOf(form: HTMLFormElement, submitter: HTMLElement | null): string | null {
  const named = form.getAttribute('data-command') ?? '';
  if (named !== 'decide') return named;
  return submitter?.tagName === 'BUTTON' ? submitter.getAttribute('value') : null;
}

function formOf(target: EventTarget | null): HTMLFormElement | null {
  const element = target as Element | null;
  if (element === null || element.tagName !== 'FORM') return null;
  return element.hasAttribute('data-command') ? (element as HTMLFormElement) : null;
}

function setOutcome(form: HTMLFormElement, text: string): void {
  const region = form.querySelector('[data-outcome]');
  if (region !== null) region.textContent = text;
}

function goBusy(form: HTMLFormElement): readonly Element[] {
  form.setAttribute('aria-busy', 'true');
  const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type])')];
  const quiet = buttons.filter((button) => button.getAttribute('aria-disabled') !== 'true');
  for (const button of quiet) button.setAttribute('aria-disabled', 'true');
  return quiet;
}

function settle(form: HTMLFormElement, quieted: readonly Element[]): void {
  form.removeAttribute('aria-busy');
  form.removeAttribute('data-dirty');
  for (const button of quieted) button.removeAttribute('aria-disabled');
}

async function answerOf(response: Response): Promise<{ status: string; reason: string }> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null)
    return { status: 'error', reason: 'internal_error' };
  const read = new Map(Object.entries(body));
  const status = read.get('status');
  const reason = read.get('reason');
  if (status === 'accepted') return { status, reason: '' };
  return { status: 'error', reason: typeof reason === 'string' ? reason : 'internal_error' };
}

async function send(form: HTMLFormElement, command: string, deps: CommandDeps): Promise<boolean> {
  const body = commandBody(command, formFields(form), deps.uuid());
  if (body === null) {
    setOutcome(form, reasonText('malformed_command'));
    return false;
  }
  const harness = form.getAttribute('data-harness') ?? '';
  const response = await deps
    .fetch(`/api/harness/${harness}/commands/${command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  const answer =
    response === null ? { status: 'error', reason: 'internal_error' } : await answerOf(response);
  const accepted = answer.status === 'accepted';
  setOutcome(form, accepted ? (outcomes.get(command) ?? '') : reasonText(answer.reason));
  return accepted;
}

async function onSubmit(event: SubmitEvent, deps: CommandDeps): Promise<void> {
  const form = formOf(event.target);
  if (form === null) return;
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.getAttribute('aria-disabled') === 'true' || form.hasAttribute('aria-busy')) return;
  const command = commandOf(form, submitter);
  if (command === null) return;
  const quieted = goBusy(form);
  const accepted = await send(form, command, deps);
  settle(form, quieted);
  if (accepted) deps.afterAccepted();
}

function markDirty(event: Event): void {
  const target = event.target as Element | null;
  target?.closest('form[data-command]')?.setAttribute('data-dirty', '');
}

export function wireCommandForms(root: Document | Element, deps: CommandDeps): void {
  root.addEventListener('submit', (event) => void onSubmit(event as SubmitEvent, deps));
  root.addEventListener('input', markDirty);
}
