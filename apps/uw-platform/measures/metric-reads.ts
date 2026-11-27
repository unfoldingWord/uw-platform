import type { MetricContext } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { resourcesInContext, type ContextResource } from './context-resources.ts';
import { readableMeasure, type MeasurePage } from './measure-pages.ts';
import { metricFigures, type Measured, type MetricOf, type MetricReply } from './metrics.ts';
import { seriesOf } from './observation-reads.ts';

export type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

export type MetricRead =
  | { readonly ok: true; readonly value: MetricReply }
  | { readonly ok: false; readonly reason: 'page_not_found' | 'property_not_found' };

export type MetricInput = {
  readonly measureId: string;
  readonly metric: string;
  readonly context: MetricContext;
};

export function metricOfMeasure(measure: MeasurePage, key: string): MetricOf | null {
  const metric = measure.measure.metrics.find((each) => each.key === key);
  const value = measure.measure.values.find((each) => each.key === metric?.value);
  return metric === undefined || value === undefined ? null : { metric, value };
}

export async function measuredIn(
  db: Executor,
  measureId: string,
  resources: readonly ContextResource[],
  trials: boolean,
): Promise<readonly Measured[]> {
  const resourceIds = resources.map((resource) => resource.resourceId);
  const series = await seriesOf(db, measureId, { resourceIds, trials });
  return resources.map((resource) => ({
    resourceId: resource.resourceId,
    title: resource.title,
    series: series.get(resource.resourceId) ?? [],
  }));
}

export async function readMetric(reader: Reader, input: MetricInput): Promise<MetricRead> {
  const { db, actor, at } = reader;
  const measure = await readableMeasure(db, actor, input.measureId, at);
  if (measure === null) return { ok: false, reason: 'page_not_found' };
  const of = metricOfMeasure(measure, input.metric);
  if (of === null) return { ok: false, reason: 'property_not_found' };
  const resources = await resourcesInContext(db, actor, input.context, at);
  const measured = await measuredIn(db, measure.id, resources, false);
  return { ok: true, value: { measureId: measure.id, ...metricFigures(of, measured) } };
}
