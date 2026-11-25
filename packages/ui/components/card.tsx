import type { Child } from 'hono/jsx';
import { Section } from './section.tsx';

export function Card(props: {
  readonly title?: string;
  readonly sub?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly flush?: boolean | undefined;
  readonly children?: Child;
}) {
  return (
    <Section title={props.title} sub={props.sub} actions={props.actions} flush={props.flush}>
      {props.children}
    </Section>
  );
}
