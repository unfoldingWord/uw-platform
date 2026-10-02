import { eventEvidenceSchemas, type HarnessEvent } from '@uw/contracts';
import { checkClaims } from './claims.ts';
import type { ValidationContext } from './context.ts';

const maxFailure = 500;
const quoted = 80;

export function attachedPageIds(events: readonly HarnessEvent[]): readonly string[] {
  const ids = events
    .filter((event) => event.name === 'learning_attached')
    .map((event) => eventEvidenceSchemas.learning_attached.parse(event.evidence).pageId);
  return [...new Set(ids)];
}

function memoryFailures(context: ValidationContext, attached: readonly string[]): string[] {
  const remembered = attached.some((id) => {
    const page = context.pages.get(id);
    return (
      page !== undefined &&
      (page.type === 'learning' || page.type === 'skill') &&
      (page.status === 'suggested' || page.status === 'active')
    );
  });
  const signed = context.events.some(
    (event) => event.name === 'nothing_learned' && event.actor.startsWith('human:'),
  );
  return remembered || signed
    ? []
    : [
        'learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker',
      ];
}

function missingPages(context: ValidationContext, attached: readonly string[]): string[] {
  return attached
    .filter((id) => !context.pages.has(id))
    .map((id) => `learning_attached: page ${id} does not exist`);
}

function labelFailures(context: ValidationContext, attached: readonly string[]): string[] {
  return attached.flatMap((id) => {
    const page = context.pages.get(id);
    if (page === undefined || page.type === 'skill') return [];
    const { claims, unlabelled } = checkClaims(page.bodyMd);
    if (claims === 0) return [`learning_attached: page ${id} states no claim`];
    return unlabelled.map((claim) =>
      `learning_attached: page ${id} has a claim without an evidence label: ${claim.slice(0, quoted)}`.slice(
        0,
        maxFailure,
      ),
    );
  });
}

export function learningAttached(context: ValidationContext): readonly string[] {
  const attached = attachedPageIds(context.events);
  return [
    ...memoryFailures(context, attached),
    ...missingPages(context, attached),
    ...labelFailures(context, attached),
  ];
}
