import { safeHref } from './href.ts';

export type NavItem = { readonly href: string; readonly label: string; readonly jd?: string };

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

function NavLink(props: { readonly item: NavItem; readonly current: boolean }) {
  const { item, current } = props;
  const href = safeHref(item.href);
  if (href === undefined) return null;
  return (
    <li>
      <a
        href={href}
        aria-current={current ? 'page' : undefined}
        class={`flex items-baseline gap-2 rounded-md px-3 py-2 text-ocean-panel-ink hover:underline aria-[current=page]:font-bold aria-[current=page]:underline ${focus}`}
      >
        {item.jd === undefined ? null : <span class="font-mono text-xs">{item.jd}</span>}
        <span>{item.label}</span>
      </a>
    </li>
  );
}

export function Sidebar(props: { readonly items: readonly NavItem[]; readonly current: string }) {
  return (
    <nav aria-label="Main" class="bg-ocean-panel p-4 text-ocean-panel-ink">
      <p class="text-lg font-extrabold">unfoldingWord</p>
      <details class="peer mt-2 md:hidden">
        <summary class={`cursor-pointer rounded-md px-3 py-2 ${focus}`}>Menu</summary>
      </details>
      <ul class="mt-2 hidden flex-col gap-1 peer-open:flex md:flex">
        {props.items.map((item) => (
          <NavLink item={item} current={item.href === props.current} />
        ))}
      </ul>
    </nav>
  );
}
