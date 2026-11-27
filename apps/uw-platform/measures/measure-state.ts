import type { MeasureAwaiting } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { activationFor, type Activation } from './activations.ts';
import { awaitingOf } from './authoring.ts';
import {
  offeredDashboards,
  readableMeasure,
  type MeasurePage,
  type OfferedDashboard,
} from './measure-pages.ts';
import type { RunObservation } from './observation-records.ts';
import { resourcesOfView } from './resources.ts';
import { readableOfRun } from './run-reads.ts';
import { latestRunOf, type RunRecord } from './runs.ts';
import { filledCommand, hostsReached, toolHashOf } from './tool.ts';

type CommandFor = {
  readonly title: string;
  readonly command: readonly string[];
  readonly hosts: readonly string[];
};

export type MeasureState = {
  readonly measure: MeasurePage;
  readonly awaiting: MeasureAwaiting;
  readonly activation: Activation | null;
  readonly latestRun: RunRecord | null;
  readonly runObservations: readonly RunObservation[];
  readonly refusedHosts: readonly string[];
  readonly commands: readonly CommandFor[];
  readonly dashboards: readonly OfferedDashboard[];
  readonly admin: boolean;
  readonly editor: boolean;
};

const SHOWN_RESOURCES = 10;

async function commandsFor(db: Executor, actor: Principal, measure: MeasurePage, at: Date) {
  const request = { viewId: measure.measure.resources.view, most: SHOWN_RESOURCES };
  const listed = (await resourcesOfView(db, actor, request, at)) ?? [];
  return listed.map((resource) => ({
    title: resource.title,
    command: filledCommand(measure.measure.command, resource.address),
    hosts: hostsReached(resource.address),
  }));
}

export async function measureStateFor(
  db: Executor,
  actor: Principal,
  measureId: string,
  at: Date,
): Promise<MeasureState | null> {
  const measure = await readableMeasure(db, actor, measureId, at);
  if (measure === null) return null;
  const toolHash = await toolHashOf(measure.measure);
  const latestRun = await latestRunOf(db, measure.id);
  const area = { kind: 'area', area: measure.jdArea } as const;
  return {
    measure,
    awaiting: await awaitingOf(db, measure, toolHash),
    activation: await activationFor(db, measure.id),
    latestRun,
    ...(await readableOfRun(db, actor, latestRun, at)),
    commands: await commandsFor(db, actor, measure, at),
    dashboards: await offeredDashboards(db, actor, measure, at),
    admin: actor.kind === 'person' && can(actor, 'admin', area, at),
    editor: actor.kind === 'person' && can(actor, 'write', area, at),
  };
}
