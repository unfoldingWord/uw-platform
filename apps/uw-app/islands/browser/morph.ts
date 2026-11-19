import { Idiomorph } from 'idiomorph';

const ELEMENT_NODE = 1;

function heldByClient(node: Node): boolean {
  const element = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (
    (element?.closest('form[data-dirty], [data-draft-editor], [data-outcome-keep]') ?? null) !==
    null
  );
}

export function morphMain(target: Element, html: string): void {
  Idiomorph.morph(target, html, {
    morphStyle: 'innerHTML',
    callbacks: { beforeNodeMorphed: (node) => !heldByClient(node) },
  });
}
