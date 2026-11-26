import type { ChartSpec } from '@uw/contracts';
import { harnessFreshness } from '../../charts/freshness.ts';
import { checkedSpec, drawChart, renderedOf } from '../../charts/render.ts';
import { kernelSources } from '../../charts/sources.ts';
import { standardSpec } from '../../charts/standard.ts';
import { callerOf, type VerbContext } from '../context.ts';
import { gatedHandler, refusal, type VerbInput } from '../handler.ts';

type Input = VerbInput<'render_chart'>;

function specOf(input: Input): ChartSpec | null {
  if (input.spec !== null) return input.spec;
  return input.chart === null ? null : standardSpec(input.chart, input.params);
}

function harnessIdOf(input: Input): string | null {
  const value = specOf(input)?.query.params['harnessId'];
  return typeof value === 'string' ? value : null;
}

function sourcesOf(context: VerbContext) {
  const reader = { kernel: context.kernel, caller: callerOf(context), at: context.at };
  return kernelSources(reader, () => harnessFreshness(context.db, context.at));
}

export const renderChartVerb = gatedHandler({
  name: 'render_chart',
  hidden: (input) => refusal('harness_not_found', { harnessId: harnessIdOf(input) }),
  resource: async (context, input) => {
    const spec = specOf(input);
    if (spec === null) return refusal('malformed_command', { fields: ['chart', 'spec'] });
    const checked = checkedSpec(spec);
    if (checked.status === 'error') return refusal(checked.reason, checked.detail);
    const { harnessId } = checked.value;
    const scene = await context.kernel.reads.harness(
      callerOf(context),
      { harnessId },
      { at: context.at },
    );
    if (scene.status === 'error') return refusal(scene.reason, scene.detail);
    return { resource: { kind: 'area', area: scene.value.harness.jdArea }, found: spec };
  },
  run: async (context, _input, spec: ChartSpec) => {
    const drawn = await drawChart(sourcesOf(context), spec, 'render-chart');
    if (drawn.status === 'error') return refusal(drawn.reason, drawn.detail);
    return { status: 'accepted', output: renderedOf(drawn.value) };
  },
});
