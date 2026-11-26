import { reasonText } from '@uw/ui/components/text.ts';
import { commandBody, type CommandFields } from './command-body.ts';

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
  submit_to_gate: 'Sent',
  approve: 'Approved',
  decide_gates: 'Approved',
  refute_finding: 'Marked refuted',
  reject: 'Rejected',
  take_over: 'You hold this item now',
  override: 'Overridden',
  activate_persona: 'Done.',
  open_workflow_draft: 'Draft open',
  discard_workflow_draft: 'Draft discarded',
  publish_workflow_draft: 'Published',
  take_over_workflow_draft: 'You hold the draft now',
  set_stage_rules: 'Saved',
  set_shadow: 'Saved',
  set_hosted_builder: 'Saved',
  set_freeze: 'Saved',
  schedule_regular_tweak: 'Granted',
  revoke_delegation: 'Revoked',
  pause: 'Paused',
  resume: 'Resumed',
  grant_role: 'Granted',
  revoke_role: 'Revoked',
  approve_person: 'Approved',
  decline_person: 'Declined',
  name_category: 'Saved',
  declare_jd_map: 'Declared',
  remove_jd_map: 'Removed',
  place_in_cascade: 'Placed',
  create_credential: 'Added',
  rotate_credential: 'Rotated',
  revoke_credential: 'Revoked',
  bind_credential: 'Bound',
  unbind_credential: 'Unbound',
  grant_reveal: 'Granted',
  confirm_reveal: 'Confirmed',
  revoke_reveal: 'Revoked',
  set_property: 'Saved',
  move_card: 'Moved',
  create_row: 'Created',
  run_measure_trial:
    'Trial started, or queued until a sandbox is free. Reload to see each outcome.',
  activate_measure: 'Activated. It runs on its schedule.',
  run_measure_now: 'Run started, or queued until a sandbox is free. Reload to see each outcome.',
  activate_dashboard: 'This dashboard is active.',
};

const outcomes: ReadonlyMap<string, string> = new Map(Object.entries(OUTCOME_TEXT));
type Control = Element & { readonly value: string; readonly checked?: boolean };

function counted(control: Control): boolean {
  const type = control.getAttribute('type');
  if (type === 'checkbox' || type === 'radio') return control.checked === true;
  return !control.hasAttribute('disabled');
}

const fieldTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function formFields(form: HTMLFormElement): CommandFields {
  const controls = [...form.elements].filter(
    (element): element is Control => fieldTags.has(element.tagName) && element.hasAttribute('name'),
  );
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
  if (element.hasAttribute('data-new-workflow')) return null;
  return element.hasAttribute('data-command') ? (element as HTMLFormElement) : null;
}

export function setOutcome(form: HTMLFormElement, text: string): void {
  const region = form.querySelector('[data-outcome]');
  if (region !== null) region.textContent = text;
}

function keepOutcome(form: HTMLFormElement, text: string): void {
  const kept = form.ownerDocument.querySelector('[data-outcome-keep]');
  if (kept !== null && form.hasAttribute('data-endpoint')) kept.textContent = text;
}

export function goBusy(form: HTMLFormElement): readonly Element[] {
  form.setAttribute('aria-busy', 'true');
  const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type])')];
  const quiet = buttons.filter((button) => button.getAttribute('aria-disabled') !== 'true');
  for (const button of quiet) button.setAttribute('aria-disabled', 'true');
  return quiet;
}

function forget(form: HTMLFormElement): void {
  for (const field of form.querySelectorAll('[data-forget]')) {
    (field as Element & { value: string }).value = '';
  }
}

export function settle(
  form: HTMLFormElement,
  quieted: readonly Element[],
  accepted: boolean,
): void {
  form.removeAttribute('aria-busy');
  if (accepted) form.removeAttribute('data-dirty');
  if (accepted) forget(form);
  for (const button of quieted) button.removeAttribute('aria-disabled');
}

export async function answerOf(response: Response): Promise<{ status: string; reason: string }> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null)
    return { status: 'error', reason: 'internal_error' };
  const read = new Map(Object.entries(body));
  const status = read.get('status');
  const reason = read.get('reason');
  if (status === 'accepted') return { status, reason: '' };
  return { status: 'error', reason: typeof reason === 'string' ? reason : 'internal_error' };
}

function endpointOf(form: HTMLFormElement): string {
  const platform = form.getAttribute('data-endpoint');
  if (platform !== null) return platform;
  const harness = form.getAttribute('data-harness') ?? '';
  return `/api/harness/${encodeURIComponent(harness)}/commands`;
}

async function send(form: HTMLFormElement, command: string, deps: CommandDeps): Promise<boolean> {
  const body = commandBody(command, formFields(form), deps.uuid());
  if (body === null) {
    setOutcome(form, reasonText('malformed_command'));
    return false;
  }
  const response = await deps
    .fetch(`${endpointOf(form)}/${encodeURIComponent(command)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  const answer =
    response === null ? { status: 'error', reason: 'internal_error' } : await answerOf(response);
  const accepted = answer.status === 'accepted';
  const done = form.getAttribute('data-done') ?? outcomes.get(command) ?? '';
  setOutcome(form, accepted ? done : reasonText(answer.reason));
  if (accepted) keepOutcome(form, done);
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
  keepOutcome(form, '');
  const accepted = await send(form, command, deps);
  settle(form, quieted, accepted);
  if (accepted) deps.afterAccepted();
}

function markDirty(event: Event): void {
  const target = event.target as (Element & { readonly form?: HTMLFormElement | null }) | null;
  const linked = target?.form?.hasAttribute('data-command') === true ? target.form : null;
  (linked ?? target?.closest('form[data-command]'))?.setAttribute('data-dirty', '');
}

export function wireCommandForms(root: Document | Element, deps: CommandDeps): void {
  root.addEventListener('submit', (event) => void onSubmit(event as SubmitEvent, deps));
  root.addEventListener('input', markDirty);
}
