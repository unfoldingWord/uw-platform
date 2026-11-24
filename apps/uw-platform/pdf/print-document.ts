import type { Element, ElementContent, Root, RootContent } from 'hast';
import { appCss } from '@uw/ui/generated/app-css';
import { fontFiles } from '@uw/ui/generated/fonts';
import { element, htmlOf, printedBody, text, type ImageOf } from './print-html.ts';
import { footerTemplate, headerTemplate } from './print-templates.ts';
import type { Provenance } from './provenance.ts';
import type { PrintJob } from './renderer.ts';

export type Printed = {
  readonly reference: string;
  readonly filters: readonly string[];
  readonly hashInput:
    | { readonly kind: 'hash'; readonly sha256: string }
    | { readonly kind: 'text'; readonly text: string };
};

export type PrintInput = {
  readonly title: string;
  readonly bodyHtml: string;
  readonly provenance: Provenance;
  readonly origin: string;
  readonly image: ImageOf;
};

export type BinderSection = {
  readonly title: string;
  readonly reference: string;
  readonly html: string;
};

export type BinderCover = {
  readonly title: string;
  readonly exportedBy: string;
  readonly exportedOn: string;
};

let inlined: string | null = null;

function stylesheet(): string {
  inlined ??= fontFiles.reduce(
    (css, font) =>
      css.replaceAll(`url(${font.path})`, `url(data:font/woff2;base64,${font.base64})`),
    appCss,
  );
  return inlined;
}

function row(term: string, value: ElementContent): ElementContent[] {
  return [element('dt', {}, [text(term)]), element('dd', {}, [value])];
}

function filtersOf(filters: readonly string[]): ElementContent {
  if (filters.length === 0) return text('None');
  return element(
    'ul',
    {},
    filters.map((filter) => element('li', {}, [text(filter)])),
  );
}

function provenanceBlock(provenance: Provenance): Element {
  return element('section', { dataPdfProvenance: '' }, [
    element('h2', {}, [text('Provenance')]),
    element('dl', {}, [
      ...row('Source', text(provenance.source)),
      ...row('Reference', text(provenance.reference)),
      ...row('Filters', filtersOf(provenance.filters)),
      ...row('Exported by', text(provenance.exportedBy)),
      ...row('Exported on', text(provenance.exportedOn)),
      ...row('SHA-256', element('code', { dataHash: '' }, [text(provenance.sha256)])),
    ]),
  ]);
}

function linksBlock(links: readonly string[]): Element[] {
  if (links.length === 0) return [];
  const items = links.map((link, at) => element('li', { id: `pdf-link-${at + 1}` }, [text(link)]));
  return [
    element('section', { dataPdfLinks: '' }, [
      element('h2', {}, [text('Links')]),
      element('ol', {}, items),
    ]),
  ];
}

function documentOf(title: string, main: Element): string {
  const head = element('head', {}, [
    element('meta', { charSet: 'utf-8' }),
    element('title', {}, [text(title)]),
    element('style', {}, [text(stylesheet())]),
  ]);
  const html = element('html', { lang: 'en', dataTheme: 'light' }, [
    head,
    element('body', {}, [main]),
  ]);
  return htmlOf({ type: 'root', children: [{ type: 'doctype' }, html] });
}

export async function printJob(input: PrintInput): Promise<PrintJob> {
  const body = await printedBody(input.bodyHtml, input.origin, input.image);
  const content = body.nodes.filter((node): node is ElementContent => node.type !== 'doctype');
  const main = element('main', { dataPdfDocument: '' }, [
    ...content,
    ...linksBlock(body.links),
    provenanceBlock(input.provenance),
  ]);
  return {
    title: input.title,
    html: documentOf(input.title, main),
    header: headerTemplate(input.title),
    footer: footerTemplate(input.provenance),
  };
}

function partId(at: number): string {
  return `part-${at + 1}`;
}

function coverOf(cover: BinderCover): Element {
  return element('section', { dataPdfCover: '' }, [
    element('h1', {}, [text(cover.title)]),
    element('p', {}, [text(`Exported by ${cover.exportedBy} on ${cover.exportedOn}`)]),
  ]);
}

function contentsOf(sections: readonly BinderSection[]): Element {
  const items = sections.map((section, at) =>
    element('li', {}, [element('a', { href: `#${partId(at)}` }, [text(section.title)])]),
  );
  return element('nav', { dataPdfContents: '' }, [
    element('h2', {}, [text('Contents')]),
    element('ol', {}, items),
  ]);
}

function sectionOf(section: BinderSection, at: number): Element {
  return element('section', { dataPdfSection: '', id: partId(at) }, [
    element('h1', {}, [text(section.title)]),
    element('p', { dataPdfReference: '' }, [text(section.reference)]),
    { type: 'raw', value: section.html },
  ]);
}

export function binderBody(sections: readonly BinderSection[], cover: BinderCover): string {
  const children: RootContent[] = [
    coverOf(cover),
    contentsOf(sections),
    ...sections.map(sectionOf),
  ];
  const tree: Root = { type: 'root', children };
  return htmlOf(tree);
}
