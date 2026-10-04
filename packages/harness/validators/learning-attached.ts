import { eventEvidenceSchemas, type HarnessEvent } from '@uw/contracts';
import { checkClaims } from './claims.ts';
import type { Attachment, ValidationContext } from './context.ts';

const maxFailure = 500;
const quoted = 80;

function attachmentsOf(
  events: readonly HarnessEvent[],
  attaching: readonly Attachment[] = [],
): readonly Attachment[] {
  const recorded = events
    .filter((event) => event.name === 'learning_attached')
    .map((event) => eventEvidenceSchemas.learning_attached.parse(event.evidence));
  const byPage = new Map<string, Attachment>();
  for (const attachment of [...recorded, ...attaching]) {
    if (!byPage.has(attachment.pageId)) byPage.set(attachment.pageId, attachment);
  }
  return [...byPage.values()];
}

export function attachedPageIds(
  events: readonly HarnessEvent[],
  attaching: readonly Attachment[] = [],
): readonly string[] {
  return attachmentsOf(events, attaching).map((attachment) => attachment.pageId);
}

function remembers(context: ValidationContext, attachment: Attachment): boolean {
  const page = context.pages.get(attachment.pageId);
  return (
    attachment.kind === 'learning' &&
    page !== undefined &&
    (page.type === 'learning' || page.type === 'skill') &&
    (page.status === 'suggested' || page.status === 'active')
  );
}

function memoryFailures(context: ValidationContext, attached: readonly Attachment[]): string[] {
  const remembered = attached.some((attachment) => remembers(context, attachment));
  const signed = context.events.some(
    (event) => event.name === 'nothing_learned' && event.actor.startsWith('human:'),
  );
  return remembered || signed
    ? []
    : [
        'learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker',
      ];
}

function named(attachment: Attachment): string {
  const noun = attachment.kind === 'revision' ? 'revision' : 'page';
  return `${noun} ${attachment.pageId}`;
}

function missingPages(context: ValidationContext, attached: readonly Attachment[]): string[] {
  return attached
    .filter((attachment) => !context.pages.has(attachment.pageId))
    .map((attachment) => `learning_attached: ${named(attachment)} does not exist`);
}

function labelFailures(context: ValidationContext, attached: readonly Attachment[]): string[] {
  return attached.flatMap((attachment) => {
    const page = context.pages.get(attachment.pageId);
    if (page === undefined || page.type === 'skill') return [];
    const { claims, unlabelled } = checkClaims(page.bodyMd);
    if (claims === 0) return [`learning_attached: ${named(attachment)} states no claim`];
    return unlabelled.map((claim) =>
      `learning_attached: ${named(attachment)} has a claim without an evidence label: ${claim.slice(0, quoted)}`.slice(
        0,
        maxFailure,
      ),
    );
  });
}

export function learningAttached(context: ValidationContext): readonly string[] {
  const attached = attachmentsOf(context.events, context.attaching);
  return [
    ...memoryFailures(context, attached),
    ...missingPages(context, attached),
    ...labelFailures(context, attached),
  ];
}
