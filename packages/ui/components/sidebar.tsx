export type NavItem = { readonly href: string; readonly label: string; readonly jd?: string };

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

function NavLink(props: { readonly item: NavItem; readonly current: boolean }) {
  const { item, current } = props;
  return (
    <li>
      <a
        href={item.href}
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
    <aside class="bg-ocean-panel p-4 text-ocean-panel-ink">
      <p class="text-lg font-extrabold">unfoldingWord</p>
      <details class="group mt-2">
        <summary class={`cursor-pointer rounded-md px-3 py-2 md:hidden ${focus}`}>Menu</summary>
        <nav
          aria-label="Main"
          class="hidden group-open:block md:block md:details-content:[content-visibility:visible]"
        >
          <ul class="mt-2 flex flex-col gap-1">
            {props.items.map((item) => (
              <NavLink item={item} current={item.href === props.current} />
            ))}
          </ul>
        </nav>
      </details>
    </aside>
  );
}
