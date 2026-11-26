import type { z } from 'zod';
import type { MeasurePage } from './measure-pages.ts';
import type { Measured } from './metrics.ts';
import type { verbIo } from '@uw/contracts';
import { readableMeasure } from './measure-pages.ts';
import { measuredIn, type Reader } from './metric-reads.ts';
import { metricFigures } from './metrics.ts';
import { readableServing } from './report-cards.ts';

export type EntityMeasure = z.infer<
  (typeof verbIo)['resolve_context']['output']
>['measures'][number];

function figuresOf(measure: MeasurePage, measured: readonly Measured[]): EntityMeasure['metrics'] {
  return measure.measure.metrics.flatMap((metric) => {
    const value = measure.measure.values.find((each) => each.key === metric.value);
    if (value === undefined) return [];
    const figures = metricFigures({ metric, value }, measured);
    const { name, rule, unit, target, asOf, figure, coverage } = figures;
    return [{ metric: figures.metric, name, rule, unit, target, asOf, figure, coverage }];
  });
}

export async function entityMeasures(
  reader: Reader,
  pageId: string | null,
): Promise<readonly EntityMeasure[]> {
  if (pageId === null) return [];
  const { resources, measureIds } = await readableServing(reader, pageId);
  const found: EntityMeasure[] = [];
  for (const measureId of measureIds) {
    const measure = await readableMeasure(reader.db, reader.actor, measureId, reader.at);
    if (measure === null) continue;
    const measured = await measuredIn(reader.db, measure.id, resources, false);
    found.push({
      measureId: measure.id,
      title: measure.title,
      metrics: figuresOf(measure, measured),
    });
  }
  return found;
}
