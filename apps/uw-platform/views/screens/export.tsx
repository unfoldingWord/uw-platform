import type { Context } from 'hono';
import { z } from 'zod';
import { formatDate } from '@uw/core/dates';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { FormShape } from '@uw/ui/shapes/form.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { exportPath, readExport, type ExportRecord } from '../../pdf/exports.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { notFound } from './not-found.tsx';

const REFRESH_EVERY_MS = 5_000;
const EYEBROW = 'PDF export';

function Status(props: { readonly found: ExportRecord }) {
  const { found } = props;
  if (found.status === 'queued') {
    return (
      <p class="m-0 text-sm">
        This PDF is being prepared. This screen refreshes until it is ready.
      </p>
    );
  }
  if (found.status === 'failed') {
    return <Note>{`Not exported: ${reasonText(found.failure ?? 'internal_error')}.`}</Note>;
  }
  if (found.status === 'expired') {
    return <p class="m-0 text-sm">This PDF has expired. Export it again from its page.</p>;
  }
  if (found.withheld !== null) {
    return <Note>{`Not available for download: ${reasonText(found.withheld)}.`}</Note>;
  }
  return <Ready found={found} />;
}

function Ready(props: { readonly found: ExportRecord }) {
  const { found } = props;
  return (
    <>
      <p class="m-0">
        <ButtonLink href={found.file} variant="primary" icon="file-export" attrs={{ download: '' }}>
          Download the PDF
        </ButtonLink>
      </p>
      <p class="m-0 text-sm text-text-3">{`Available until ${formatDate(found.expiresAt)}.`}</p>
      <p class="m-0 text-sm text-text-3">
        {'File SHA-256 '}
        <code class="font-mono break-all">{found.fileSha256}</code>
      </p>
      <p class="m-0 text-sm text-text-3">
        {'Source SHA-256 '}
        <code class="font-mono break-all">{found.sourceSha256}</code>
      </p>
    </>
  );
}

function liveWhile(found: ExportRecord) {
  if (found.status !== 'queued') return undefined;
  return { screen: 'home' as const, harnesses: [], refreshEveryMs: REFRESH_EVERY_MS };
}

export async function exportScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const id = z.uuid().safeParse(c.req.param('exportId'));
  const { actor } = screen.caller;
  const found = id.success ? await readExport(database.db, actor, id.data, screen.at) : null;
  if (found === null) return notFound(c);
  const live = liveWhile(found);
  const spec = {
    title: found.title,
    current: exportPath(found.exportId),
    crumbs: [{ label: EYEBROW }, { label: found.title }],
    ...(live === undefined ? {} : { live }),
  };
  return renderScreen(
    c,
    spec,
    <FormShape head={{ eyebrow: EYEBROW, title: found.title, lede: found.reference }}>
      <Section title="Status">
        <Status found={found} />
      </Section>
    </FormShape>,
  );
}
