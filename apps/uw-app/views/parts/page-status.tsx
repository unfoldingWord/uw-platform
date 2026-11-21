import type { PageStatus } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';

const notLiveWords: Readonly<Partial<Record<PageStatus, string>>> = {
  draft: 'Draft',
  suggested: 'Not live yet',
};

export function PageStatusBadge(props: { readonly status: PageStatus }) {
  const words = notLiveWords[props.status];
  if (words === undefined) return null;
  return (
    <span data-page-status={props.status}>
      <Badge tone="neutral">{words}</Badge>
    </span>
  );
}
