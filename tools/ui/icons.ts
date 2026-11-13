export const iconNames = [
  'award',
  'bars',
  'bars-filter',
  'book-open',
  'bullseye',
  'calendar',
  'chart-column',
  'check',
  'chevron-down',
  'chevron-left',
  'circle-check',
  'circle-dot',
  'clock',
  'cloud',
  'code-branch',
  'code-pull-request',
  'comments',
  'cube',
  'cubes',
  'desktop',
  'diagram-project',
  'diamond',
  'ellipsis',
  'file-lines',
  'file-signature',
  'globe',
  'heart',
  'hourglass-half',
  'house',
  'inbox',
  'laptop',
  'layer-group',
  'lock',
  'magnifying-glass',
  'moon',
  'plus',
  'receipt',
  'robot',
  'scale-balanced',
  'shield-check',
  'shield-halved',
  'sparkles',
  'square-kanban',
  'sun',
  'table-cells',
  'user',
  'user-check',
  'users',
  'wave-pulse',
] as const;

const freeSubstitutes: Readonly<Record<string, string>> = {
  'bars-filter': 'filter',
  'shield-check': 'shield-halved',
  sparkles: 'wand-magic-sparkles',
  'square-kanban': 'table-columns',
  'wave-pulse': 'heart-pulse',
};

type IconDefinition = { readonly icon: readonly unknown[] };
export type IconPack = Readonly<Record<string, IconDefinition | undefined>>;
export type Glyph = {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly string[];
};

function exportName(name: string): string {
  return `fa${name.replace(/(^|-)([a-z0-9])/g, (_match, _dash, letter: string) => letter.toUpperCase())}`;
}

function glyphOf(definition: IconDefinition | undefined): Glyph | null {
  if (definition === undefined) return null;
  const [width, height, , , path] = definition.icon;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  const paths = Array.isArray(path) ? path.map(String) : [String(path)];
  return { width, height, paths };
}

export function freeGlyph(name: string, packs: readonly IconPack[]): Glyph | null {
  const candidates = [name, freeSubstitutes[name]].filter((key) => key !== undefined);
  for (const key of candidates)
    for (const pack of packs) {
      const glyph = glyphOf(pack[exportName(key)]);
      if (glyph !== null) return glyph;
    }
  return null;
}

export function proGlyph(name: string, pack: IconPack): Glyph | null {
  return glyphOf(pack[exportName(name)]);
}

export function iconModule(
  names: readonly string[],
  regular: (name: string) => Glyph | null,
  duotone: (name: string) => Glyph | null,
): string {
  const entries = (pick: (name: string) => Glyph | null): string[] =>
    names.map((name) => `  '${name}': ${JSON.stringify(pick(name))},`);
  return [
    `export const iconNames = ${JSON.stringify(names)} as const;`,
    'export type IconName = (typeof iconNames)[number];',
    'export type Glyph = { readonly width: number; readonly height: number; readonly paths: readonly string[] };',
    'export const regularGlyphs: Readonly<Record<IconName, Glyph | null>> = {',
    ...entries(regular),
    '};',
    'export const duotoneGlyphs: Readonly<Record<IconName, Glyph | null>> = {',
    ...entries(duotone),
    '};',
    '',
  ].join('\n');
}
