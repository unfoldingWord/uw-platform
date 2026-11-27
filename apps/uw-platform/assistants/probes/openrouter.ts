import { engineConfigOf } from '../../engines/config.ts';
import { engineAdapter, engineRegistryOf } from '../../engines/registry.ts';
import { checked, failed, skipped, type ProbeResult } from './report.ts';
import { bindingsOf, errorName, notConfigured, setting, type ProbeDeps } from './setup.ts';

const SETTINGS = [
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_ACCOUNT_ID',
  'AI_GATEWAY_ID',
  'ALWAYS_ON_MODEL',
  'ALWAYS_ON_PROVIDER',
];

export async function openRouterProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const model = deps.env['ALWAYS_ON_MODEL'] ?? '';
  const provider = deps.env['ALWAYS_ON_PROVIDER'] ?? '';
  const configured = SETTINGS.every((name) => (setting(deps.env, name) ?? '').trim() !== '');
  if (!configured) return [skipped('s4.1', notConfigured(deps.env, SETTINGS))];
  const config = engineConfigOf(bindingsOf(deps.env), deps.fetcher);
  const turn = engineAdapter(engineRegistryOf(config), 'openrouter-messages').turn;
  if (turn === null) return [failed('s4.1', 'the OpenRouter engine offers no model turn')];
  try {
    const result = await turn({
      engine: 'openrouter-messages',
      model,
      pinnedProvider: provider,
      persona: 'staging-probe',
      instructions: 'Answer with the single word OK.',
      tools: ['list_reminders'],
      messages: [{ role: 'user', text: 'Are you there?' }],
      traceId: crypto.randomUUID(),
      zeroRetention: true,
    });
    const costed = result.usage.costMicros !== null;
    const detail = `${result.resolvedModel} served by ${result.resolvedProvider} with provider.zdr; cost ${costed ? `${String(result.usage.costMicros)} micros` : 'not reported'}`;
    return [checked('s4.1', costed, detail)];
  } catch (error) {
    return [failed('s4.1', errorName(error))];
  }
}
