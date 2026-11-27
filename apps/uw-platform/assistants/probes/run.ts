import { directoryProbes } from './directory.ts';
import { gmailProbes } from './gmail.ts';
import { calendarProbes } from './google.ts';
import { manualChecks } from './manual.ts';
import { openRouterProbes } from './openrouter.ts';
import type { ProbeResult } from './report.ts';
import { researchProbes } from './research.ts';
import type { ProbeDeps } from './setup.ts';
import { zulipProbes } from './zulip.ts';

export type { ProbeEnv } from './setup.ts';

export async function runAssistantProbes(deps: ProbeDeps): Promise<readonly ProbeResult[]> {
  return [
    ...(await zulipProbes(deps)),
    ...(await openRouterProbes(deps)),
    ...(await calendarProbes(deps)),
    ...(await directoryProbes(deps)),
    ...(await gmailProbes(deps)),
    ...(await researchProbes(deps)),
    ...manualChecks(),
  ];
}
