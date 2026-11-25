import { safeHref } from './href.ts';

export type LinkNode = {
  readonly label: string;
  readonly href: string;
  readonly children: readonly LinkNode[];
};

const link =
  'text-base font-regular text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

const COLUMNS_FROM = 9;

function Branch(props: { readonly nodes: readonly LinkNode[] }) {
  return (
    <ul class="m-0 mt-2 flex list-none flex-col gap-2 border-l border-line-soft p-0 pl-4">
      {props.nodes.map((node) => (
        <li>
          <a href={safeHref(node.href)} class={`${link} text-text-2`}>
            {node.label}
          </a>
          {node.children.length === 0 ? null : <Branch nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}

export function LinkTree(props: { readonly label: string; readonly nodes: readonly LinkNode[] }) {
  const columns = props.nodes.length >= COLUMNS_FROM ? 'md:columns-2 md:gap-7' : '';
  return (
    <ul aria-label={props.label} data-tree="" class={`m-0 list-none p-0 ${columns}`}>
      {props.nodes.map((node) => (
        <li class="break-inside-avoid pb-2">
          <a href={safeHref(node.href)} class={link}>
            {node.label}
          </a>
          {node.children.length === 0 ? null : <Branch nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}
