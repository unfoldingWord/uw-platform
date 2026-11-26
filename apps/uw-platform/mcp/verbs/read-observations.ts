import type { z } from 'zod';
import type { verbIo } from '@uw/contracts';
import { readableMeasure } from '../../measures/measure-pages.ts';
import { readableObservations, type ObservationRow } from '../../measures/observation-reads.ts';
import { gatedHandler } from '../handler.ts';
import { hiddenMeasure, storedMeasureArea } from './measure-scene.ts';

type Reply = z.infer<(typeof verbIo)['read_observations']['output']>;

function rowOf(row: ObservationRow): Reply['observations'][number] {
  const { observationId, runId, runKind, resourceId, measureVersion } = row;
  const { toolVersion, outcome, reason, values } = row;
  const observedAt = row.observedAt.toISOString();
  return {
    ...{ observationId, runId, runKind, resourceId, measureVersion, observedAt },
    ...{ toolVersion, outcome, reason, values },
  };
}

export const readObservationsVerb = gatedHandler({
  name: 'read_observations',
  hidden: hiddenMeasure,
  resource: storedMeasureArea,
  run: async (context, input) => {
    const { db, principal, at } = context;
    const measure = await readableMeasure(db, principal, input.measureId, at);
    if (measure === null) return hiddenMeasure(input);
    const offset = Number(input.cursor ?? '0');
    const since = input.since === null ? null : new Date(input.since);
    const query = { ...input, since, offset };
    const read = await readableObservations(db, principal, query, at);
    const next = read.more ? String(offset + read.rows.length) : null;
    return { status: 'accepted', output: { observations: read.rows.map(rowOf), nextCursor: next } };
  },
});
