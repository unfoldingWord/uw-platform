import type { Context } from 'hono';
import type { HealthIndicator, HealthReport } from '@uw/contracts';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { AGENT_PLANE_INDICATORS } from '../../health/agent-plane.ts';
import { renderScreen } from '../parts/frame.tsx';
import { indicatorText, statusOf } from '../parts/health-words.ts';
import { healthPath, homePath } from '../parts/paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';
const drilled: ReadonlySet<string> = new Set(AGENT_PLANE_INDICATORS);

function Indicator(props: { readonly indicator: HealthIndicator }) {
  const { indicator } = props;
  const status = statusOf(indicator.status);
  const kpi = (
    <Kpi
      label={indicatorText(indicator.name)}
      value={status.words}
      tone={status.tone}
      detail={indicator.detail}
    />
  );
  if (!drilled.has(indicator.name)) return <li>{kpi}</li>;
  return (
    <li>
      <a href={healthPath(indicator.name)} class={`block rounded-lg ${focus}`}>
        {kpi}
      </a>
    </li>
  );
}

export function healthScreen(c: Context<AppEnv>, report: HealthReport): Promise<Response> {
  const spec = {
    title: 'Health',
    current: healthPath(),
    crumbs: [{ label: 'Home', href: homePath() }, { label: 'Health' }],
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead title="Health" lede={`Overall status: ${statusOf(report.status).words}`} />
      <ul class="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
        {report.indicators.map((indicator) => (
          <Indicator indicator={indicator} />
        ))}
      </ul>
    </>,
  );
}
