export type Status = {
  readonly loaded: string;
  readonly agents: number;
  readonly gatesOpen: number;
  readonly queue: boolean;
  readonly live: boolean;
  readonly databaseMs: number | null;
  readonly commit: string;
  readonly environment: string;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Switch(props: { readonly on: boolean; readonly words: string }) {
  return (
    <span class={props.on ? 'text-text-2' : undefined}>
      {props.words} {props.on ? 'on' : 'off'}
    </span>
  );
}

export function StatusBar(props: { readonly status: Status }) {
  const { status } = props;
  return (
    <footer
      aria-label="Status"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-line bg-surface px-4 py-1 font-mono text-xs text-text-3 md:px-5"
    >
      <span class="flex items-center gap-2">
        <span aria-hidden="true" class="size-2 rounded-full bg-ok"></span>
        Loaded {status.loaded}
      </span>
      <span>{plural(status.agents, 'agent', 'agents')}</span>
      <span>{plural(status.gatesOpen, 'gate open', 'gates open')}</span>
      <Switch on={status.queue} words="queue" />
      <Switch on={status.live} words="live updates" />
      <span class="hidden flex-1 md:block"></span>
      <span>{status.databaseMs === null ? 'db not measured' : `db ${status.databaseMs} ms`}</span>
      <span>{status.commit.slice(0, 7)}</span>
      <span>{status.environment}</span>
    </footer>
  );
}
