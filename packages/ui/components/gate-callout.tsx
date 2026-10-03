import type { Child } from 'hono/jsx';
import { Note } from './note.tsx';
import { domId, reasonText } from './text.ts';

type Declaration = {
  readonly closes: readonly string[];
  readonly risks: string;
  readonly touches: string;
  readonly riskTier: string;
  readonly riskDomains: readonly string[];
};

type RiskDerived = {
  readonly riskTier: string | null;
  readonly riskDomains: readonly string[];
  readonly head: string | null;
};

export function GateCallout(props: {
  readonly title: string;
  readonly reason: string | null;
  readonly actions: Child;
  readonly children?: Child;
}) {
  const headingId = domId('gate', props.title);
  return (
    <section
      aria-labelledby={headingId}
      class="flex flex-col gap-3 rounded-lg border border-line border-l-4 border-l-ocean bg-surface p-4 text-ink"
    >
      <h2 id={headingId} class="m-0 text-lg font-bold text-ink">
        {props.title}
      </h2>
      {props.children}
      {props.reason === null ? null : <Note>{reasonText(props.reason)}</Note>}
      <div class="flex flex-wrap items-center gap-3">{props.actions}</div>
    </section>
  );
}

function Fact(props: { readonly term: string; readonly children: Child }) {
  return (
    <>
      <dt class="text-muted">{props.term}</dt>
      <dd class="m-0 break-words text-ink">{props.children}</dd>
    </>
  );
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? 'None' : values.join(', ');
}

function Declared(props: { readonly declaration: Declaration | null }) {
  const declaration = props.declaration;
  if (declaration === null) {
    return <Fact term="Declaration">No declaration was parsed from the pull request</Fact>;
  }
  return (
    <>
      <Fact term="Declared tier">{declaration.riskTier}</Fact>
      <Fact term="Declared domains">{listed(declaration.riskDomains)}</Fact>
      <Fact term="Closes">{listed(declaration.closes)}</Fact>
      <Fact term="Risks">{declaration.risks}</Fact>
      <Fact term="Touches">{declaration.touches}</Fact>
    </>
  );
}

function Derived(props: { readonly derived: RiskDerived | null }) {
  const derived = props.derived;
  if (derived === null) return <Fact term="Derived tier">Not derived</Fact>;
  return (
    <>
      <Fact term="Derived tier">
        {derived.riskTier ?? 'None'} at <code class="font-mono">{derived.head ?? 'no head'}</code>
      </Fact>
      <Fact term="Derived domains">{listed(derived.riskDomains)}</Fact>
    </>
  );
}

export function GateFacts(props: {
  readonly declaration: Declaration | null;
  readonly riskDerived: RiskDerived | null;
  readonly approvingHead: string | null;
}) {
  const derivedHead = props.riskDerived?.head ?? null;
  const moved = derivedHead !== null && derivedHead !== props.approvingHead;
  return (
    <div class="flex flex-col gap-2">
      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Declared declaration={props.declaration} />
        <Derived derived={props.riskDerived} />
        <Fact term="You approve head">
          <code class="font-mono">{props.approvingHead ?? 'No head'}</code>
        </Fact>
      </dl>
      {moved ? <Note>The tier was derived at another head than the one you approve</Note> : null}
    </div>
  );
}
