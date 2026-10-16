import type { EpicGroup } from '@uw/harness';

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 56;
export const GAP_X = 48;
const GAP_Y = 16;
export const PAD = 16;

type LaidNode = { readonly itemId: string; readonly x: number; readonly y: number };
type LaidEdge = {
  readonly from: string;
  readonly to: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};
export type EpicLayout = {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LaidNode[];
  readonly edges: readonly LaidEdge[];
};

function depthsOf(group: EpicGroup): ReadonlyMap<string, number> {
  const ids = new Set(group.nodes.map((node) => node.itemId));
  const depth = new Map(group.nodes.map((node) => [node.itemId, 0]));
  for (let pass = 0; pass < group.nodes.length; pass += 1) {
    for (const node of group.nodes) {
      const deepest = node.blockedBy
        .filter((id) => ids.has(id))
        .reduce((most, id) => Math.max(most, (depth.get(id) ?? 0) + 1), 0);
      depth.set(node.itemId, Math.min(deepest, group.nodes.length - 1));
    }
  }
  return depth;
}

function placed(group: EpicGroup, depths: ReadonlyMap<string, number>): readonly LaidNode[] {
  const rows = new Map<number, number>();
  return group.nodes.map((node) => {
    const depth = depths.get(node.itemId) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    return {
      itemId: node.itemId,
      x: PAD + depth * (NODE_WIDTH + GAP_X),
      y: PAD + row * (NODE_HEIGHT + GAP_Y),
    };
  });
}

function edgesOf(group: EpicGroup, nodes: readonly LaidNode[]): readonly LaidEdge[] {
  const at = new Map(nodes.map((node) => [node.itemId, node]));
  const middle = NODE_HEIGHT / 2;
  return group.nodes.flatMap((node) => {
    const end = at.get(node.itemId);
    return node.blockedBy.flatMap((from) => {
      const start = at.get(from);
      if (start === undefined || end === undefined) return [];
      const x1 = start.x + NODE_WIDTH;
      return [
        { from, to: node.itemId, x1, y1: start.y + middle, x2: end.x - 4, y2: end.y + middle },
      ];
    });
  });
}

export function epicLayout(group: EpicGroup): EpicLayout {
  const nodes = placed(group, depthsOf(group));
  const width = Math.max(...nodes.map((node) => node.x + NODE_WIDTH), NODE_WIDTH) + PAD;
  const height = Math.max(...nodes.map((node) => node.y + NODE_HEIGHT), NODE_HEIGHT) + PAD;
  return { width, height, nodes, edges: edgesOf(group, nodes) };
}
