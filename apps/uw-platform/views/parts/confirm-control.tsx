import type { Page } from '@uw/contracts';
import { Button } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { pageConfirmPath } from './paths.ts';

const governanceTypes: ReadonlySet<string> = new Set(['policy', 'charter', 'decision']);

export function confirmable(page: Page, canEdit: boolean, isPerson: boolean): boolean {
  return canEdit && isPerson && page.status === 'suggested' && governanceTypes.has(page.type);
}

export function ConfirmControl(props: {
  readonly page: Page;
  readonly shown: boolean;
  readonly refused: string | null;
}) {
  const { page } = props;
  if (!props.shown) return null;
  return (
    <Section
      title="Not live yet"
      sub="Confirming makes this version live; agents and readers then treat it as in force"
    >
      {props.refused === null ? null : (
        <Note>{`Not confirmed: ${reasonText(props.refused)}.`}</Note>
      )}
      <form method="post" action={pageConfirmPath(page.id)} class="flex flex-col gap-3">
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <input type="hidden" name="expectedVersion" value={String(page.version)} />
        <p class="m-0">
          <Button type="submit" variant="human">
            Confirm
          </Button>
        </p>
      </form>
    </Section>
  );
}
