import type { HarnessEvent } from '@uw/contracts';
import type { ScenarioResult } from './run.ts';

function eventLine(event: HarnessEvent, index: number): string {
  return `  ${index + 1}. ${event.at} ${event.name} ${event.actor} ${JSON.stringify(event.payload)}`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function formatResult(result: ScenarioResult): string {
  const head = `scenario ${result.name}: ${result.title}`;
  if (result.report === null) return `${head}\nresult: fail: ${result.failure ?? 'unknown'}`;
  const { events, state } = result.report;
  return [
    head,
    `events (${events.length}):`,
    ...events.map(eventLine),
    'state:',
    indent(JSON.stringify(state, null, 2)),
    'result: pass',
  ].join('\n');
}
