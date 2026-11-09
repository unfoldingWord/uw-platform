import { duotoneGlyphs, regularGlyphs, type Glyph, type IconName } from '../generated/icons.ts';

export type IconSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const sizeClasses: Readonly<Record<IconSize, string>> = {
  1: 'size-size-1',
  2: 'size-size-2',
  3: 'size-size-3',
  4: 'size-size-4',
  5: 'size-size-5',
  6: 'size-size-6',
  7: 'size-size-7',
  8: 'size-size-8',
};

export type IconProps = {
  readonly name: IconName | (string & {});
  readonly size?: IconSize;
  readonly label?: string;
  readonly duotone?: boolean;
  readonly class?: string;
};

const regular = new Map<string, Glyph | null>(Object.entries(regularGlyphs));
const duotones = new Map<string, Glyph | null>(Object.entries(duotoneGlyphs));

function glyphFor(name: string, duotone: boolean): Glyph | null {
  return (duotone ? duotones : regular).get(name) ?? null;
}

function Shapes(props: { readonly glyph: Glyph | null }) {
  const { glyph } = props;
  if (glyph === null)
    return <rect width="512" height="512" rx="64" fill="currentColor" opacity="0.2" />;
  const [secondary, primary] = glyph.paths.length > 1 ? glyph.paths : [undefined, glyph.paths[0]];
  return (
    <>
      {secondary === undefined ? null : <path d={secondary} fill="currentColor" opacity="0.4" />}
      <path d={primary} fill="currentColor" />
    </>
  );
}

export function Icon(props: IconProps) {
  const glyph = glyphFor(props.name, props.duotone === true);
  const viewBox = glyph === null ? '0 0 512 512' : `0 0 ${glyph.width} ${glyph.height}`;
  const naming =
    props.label === undefined
      ? { 'aria-hidden': 'true', focusable: 'false' }
      : { role: 'img', 'aria-label': props.label };
  const classes = [sizeClasses[props.size ?? 2], 'shrink-0', props.class ?? ''].join(' ').trim();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} class={classes} {...naming}>
      <Shapes glyph={glyph} />
    </svg>
  );
}
