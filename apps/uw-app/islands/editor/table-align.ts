import type { Ctx } from '@milkdown/kit/ctx';
import { schemaCtx } from '@milkdown/kit/core';
import {
  DOMSerializer,
  type DOMOutputSpec,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm';
import type { NodeSchema } from '@milkdown/kit/transformer';

type Spec = (ctx: Ctx) => NodeSchema;
type Rule = NonNullable<NodeSchema['parseDOM']>[number];

const ALIGNED: ReadonlySet<string> = new Set(['left', 'center', 'right']);

function alignmentOf(dom: HTMLElement): string {
  const marked = dom.getAttribute('data-align') ?? dom.style.textAlign;
  return ALIGNED.has(marked) ? marked : 'left';
}

function readsAlignment(rule: Rule): Rule {
  if (!('tag' in rule)) return rule;
  return {
    ...rule,
    getAttrs: (dom) => {
      const read = typeof rule.getAttrs === 'function' ? rule.getAttrs(dom as never) : {};
      if (read === false || read === null) return read;
      return { ...read, alignment: alignmentOf(dom as HTMLElement) };
    },
  };
}

function marksAlignment(spec: NodeSchema) {
  return (node: ProseNode): DOMOutputSpec => {
    const drawn = spec.toDOM?.(node) ?? ['td', 0];
    if (!Array.isArray(drawn)) return drawn;
    const [tag, attrs, ...rest] = drawn as [string, Record<string, unknown>, ...unknown[]];
    const kept = Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'style'));
    const align = String(node.attrs['alignment'] ?? 'left');
    return [tag, { ...kept, 'data-align': align }, ...rest] as DOMOutputSpec;
  };
}

function aligned(previous: Spec): Spec {
  return (ctx) => {
    const spec = previous(ctx);
    return {
      ...spec,
      parseDOM: (spec.parseDOM ?? []).map(readsAlignment),
      toDOM: marksAlignment(spec),
    };
  };
}

export function alignsTableCells(ctx: Ctx): void {
  ctx.update(tableCellSchema.key, aligned);
  ctx.update(tableHeaderSchema.key, aligned);
}

function styledForCopy(node: ProseNode): DOMOutputSpec {
  const drawn = node.type.spec.toDOM?.(node) ?? ['td', 0];
  if (!Array.isArray(drawn)) return drawn;
  const [tag, attrs, ...rest] = drawn as [string, Record<string, unknown>, ...unknown[]];
  const align = String(node.attrs['alignment'] ?? 'left');
  return [tag, { ...attrs, style: `text-align: ${align}` }, ...rest] as DOMOutputSpec;
}

export const copiesTableAlignment = $prose((ctx) => {
  const base = DOMSerializer.fromSchema(ctx.get(schemaCtx));
  const nodes = { ...base.nodes, table_cell: styledForCopy, table_header: styledForCopy };
  return new Plugin({
    key: new PluginKey('copiesTableAlignment'),
    props: { clipboardSerializer: new DOMSerializer(nodes, base.marks) },
  });
});
