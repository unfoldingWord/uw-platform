import { gateViewSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import shipReady from '../../../../packages/contracts/fixtures/gate-view/valid/ship-ready.json' with { type: 'json' };
import { GatePanel } from './gate-panel.tsx';

const runId = '00000000-0000-4000-8000-0000000000d1';

const view = gateViewSchema.parse({
  ...shipReady,
  verdicts: [
    {
      runId,
      persona: 'agent:reviewer',
      reviewer: 'uw-reviewer',
      verdict: 'request_changes',
      findings: [
        { text: 'The lease is never renewed.', weight: 'real', refuted: false },
        { text: 'A year of clock skew breaks it.', weight: 'theoretical', refuted: true },
      ],
    },
  ],
});

function shown(decides: boolean): string {
  const gate = { view, title: 'Show the board at Ship', ability: { can: true as const }, decides };
  return String(GatePanel({ gate }));
}

describe('RV-2 the Gates view lists Reviewer verdicts with a refute control', () => {
  it('RV-2 offers a Kindle Mark refuted control on each finding not yet refuted, outside the decision form', () => {
    const html = shown(true);
    expect(html).toContain('Reviewer verdicts on this item');
    expect(html).toContain('Real: The lease is never renewed.');
    expect(html).toContain('Theoretical: A year of clock skew breaks it.');
    expect(html).toContain('data-command="refute_finding"');
    expect(html).toContain('>Mark finding 1 of verdict 1 (uw-reviewer) refuted</button>');
    expect(html).not.toContain('Mark finding 2 of verdict 1');
    expect(html).toContain('bg-kindle');
    expect(html.indexOf('data-command="refute_finding"')).toBeGreaterThan(
      html.indexOf('data-command="decide"'),
    );
  });

  it('RV-2 names each refute control uniquely across verdicts, even two from one reviewer', () => {
    const [first] = view.verdicts;
    const second = { ...first, runId: '00000000-0000-4000-8000-0000000000d2' };
    const twice = gateViewSchema.parse({ ...view, verdicts: [first, second] });
    const gate = { view: twice, title: 'Show the board at Ship', ability: { can: true as const } };
    const html = String(GatePanel({ gate: { ...gate, decides: true } }));
    const names = [...html.matchAll(/>(Mark finding [^<]+)<\/button>/gu)].map((match) => match[1]);
    expect(names).toEqual([
      'Mark finding 1 of verdict 1 (uw-reviewer) refuted',
      'Mark finding 1 of verdict 2 (uw-reviewer) refuted',
    ]);
  });

  it('RV-2 shows the verdicts without a control to a person who does not decide the gate', () => {
    const html = shown(false);
    expect(html).toContain('Real: The lease is never renewed.');
    expect(html).not.toContain('data-command="refute_finding"');
  });
});
