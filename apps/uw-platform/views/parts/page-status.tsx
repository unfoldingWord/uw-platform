import type { Page, PageStatus } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import type { Fact } from './page-read.tsx';
import { typeWords } from './page-shown.ts';

const notLiveWords: Readonly<Partial<Record<PageStatus, string>>> = {
  draft: 'Draft',
  suggested: 'Not live yet',
};

export function isNotLive(page: { readonly status: PageStatus }): boolean {
  return notLiveWords[page.status] !== undefined;
}

export function PageStatusBadge(props: { readonly status: PageStatus }) {
  const words = notLiveWords[props.status];
  if (words === undefined) return null;
  return (
    <span data-page-status={props.status}>
      <Badge tone="neutral">{words}</Badge>
    </span>
  );
}

export function PageStatusLine(props: { readonly page: Page }) {
  const { page } = props;
  return (
    <>
      {isNotLive(page) ? <PageStatusBadge status={page.status} /> : null}
      <span>{`Version ${String(page.version)}`}</span>
    </>
  );
}

export function pageFacts(page: Page): readonly Fact[] {
  return [
    { label: 'Kind', value: typeWords[page.type] ?? page.type },
    { label: 'Area', value: page.jdArea },
  ];
}
