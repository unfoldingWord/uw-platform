import { safeHref } from './href.ts';

export type LinkNode = {
  readonly label: string;
  readonly href: string;
  readonly children: readonly LinkNode[];
};

const link =
  'text-base font-semibold text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

function Branch(props: { readonly nodes: readonly LinkNode[]; readonly label?: string }) {
  const top = props.label !== undefined;
  return (
    <ul
      aria-label={props.label}
      class={`m-0 flex list-none flex-col gap-2 p-0 ${top ? '' : 'mt-2 border-l border-line-soft pl-4'}`}
      {...(top ? { 'data-tree': '' } : {})}
    >
      {props.nodes.map((node) => (
        <li>
          <a href={safeHref(node.href)} class={link}>
            {node.label}
          </a>
          {node.children.length === 0 ? null : <Branch nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}

export function LinkTree(props: { readonly label: string; readonly nodes: readonly LinkNode[] }) {
  return <Branch nodes={props.nodes} label={props.label} />;
}
