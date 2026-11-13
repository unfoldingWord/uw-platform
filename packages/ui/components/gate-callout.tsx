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
  readonly itemId: string;
  readonly title: string;
  readonly reason: string | null;
  readonly actions: Child;
  readonly eyebrow?: Child | undefined;
  readonly aside?: Child | undefined;
  readonly meta?: Child | undefined;
  readonly children?: Child;
}) {
  const headingId = domId('gate', props.itemId);
  return (
    <section
      aria-labelledby={headingId}
      class="flex min-w-0 flex-col rounded-md border border-line bg-surface text-text"
    >
      <div class="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div class="min-w-0">
          {props.eyebrow === undefined ? null : (
            <p class="m-0 text-xs font-semibold text-text-3">{props.eyebrow}</p>
          )}
          <h2 id={headingId} class="m-0 text-lg leading-snug font-heavy tracking-tight text-text">
            {props.title}
          </h2>
          {props.meta === undefined ? null : (
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-3">
              {props.meta}
            </div>
          )}
        </div>
        {props.aside}
      </div>
      <div class="flex flex-col gap-4 px-4 py-3">
        {props.children}
        {props.reason === null ? null : <Note>{reasonText(props.reason)}</Note>}
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </div>
    </section>
  );
}

function Fact(props: { readonly term: string; readonly children: Child }) {
  return (
    <>
      <dt class="text-text-3">{props.term}</dt>
      <dd class="m-0 break-words text-text">{props.children}</dd>
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

function Derived(props: { readonly derived: RiskDerived | null; readonly when: string }) {
  const derived = props.derived;
  if (derived === null) return <Fact term={`Tier ${props.when}`}>Not derived</Fact>;
  return (
    <>
      <Fact term={`Tier ${props.when}`}>
        {derived.riskTier ?? 'None'} at{' '}
        <code class="font-mono break-all">{derived.head ?? 'no head'}</code>
      </Fact>
      <Fact term={`Domains ${props.when}`}>{listed(derived.riskDomains)}</Fact>
    </>
  );
}

export function GateFacts(props: {
  readonly declaration: Declaration | null;
  readonly riskDerived: RiskDerived | null;
  readonly derivedNow?: RiskDerived | null;
  readonly reviewProviders?: readonly string[];
  readonly head: string | null;
}) {
  const derivedHead = props.riskDerived?.head ?? null;
  const moved = derivedHead !== null && derivedHead !== props.head;
  return (
    <div class="flex flex-col gap-2">
      <dl class="m-0 grid grid-cols-label gap-x-4 gap-y-1 text-sm">
        <Declared declaration={props.declaration} />
        <Derived derived={props.riskDerived} when="recorded" />
        {props.derivedNow === undefined ? null : (
          <Derived derived={props.derivedNow} when="derived now" />
        )}
        {props.reviewProviders === undefined ? null : (
          <Fact term="Review providers">{listed(props.reviewProviders)}</Fact>
        )}
        <Fact term="You approve head">
          <code class="font-mono break-all">{props.head ?? 'No head'}</code>
        </Fact>
      </dl>
      {moved ? <Note>The tier was recorded at another head than the one you approve</Note> : null}
    </div>
  );
}
