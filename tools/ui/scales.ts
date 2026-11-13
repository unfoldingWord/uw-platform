type Rgb = readonly [number, number, number];

export const brandAnchors = {
  inspire: { hex: '#31ade3', step: 400 },
  ocean: { hex: '#014263', step: 800 },
  cultivate: { hex: '#70c9cc', step: 300 },
  kindle: { hex: '#e59d33', step: 400 },
} as const;

export const greyAnchors = {
  50: '#f4f8fa',
  100: '#e7eef2',
  300: '#c4d3db',
  600: '#5a6e7a',
} as const;

type BrandScale = keyof typeof brandAnchors;
export type ScaleName = BrandScale | 'grey';

const brandSteps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const greySteps = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950] as const;

const brandLightness: Record<number, number> = {
  50: 0.975,
  100: 0.945,
  200: 0.89,
  300: 0.82,
  400: 0.74,
  500: 0.66,
  600: 0.56,
  700: 0.47,
  800: 0.38,
  900: 0.28,
  950: 0.19,
};

const greyLightness: Record<number, number> = {
  0: 1,
  50: 0.975,
  100: 0.95,
  200: 0.905,
  300: 0.84,
  400: 0.72,
  500: 0.6,
  600: 0.5,
  700: 0.41,
  800: 0.3,
  850: 0.24,
  900: 0.2,
  950: 0.155,
};

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as unknown as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  const byte = (c: number): string =>
    Math.round(Math.max(0, Math.min(1, c)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(byte).join('')}`;
}

function rgbToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((c) => (c >= 0 ? fromLinear(c) : -fromLinear(-c))) as unknown as Rgb;
}

type Lch = { readonly lightness: number; readonly chroma: number; readonly hue: number };

function oklch(hex: string): Lch {
  const [lightness, a, b] = rgbToOklab(hexToRgb(hex));
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { lightness, chroma: Math.hypot(a, b), hue };
}

const inGamut = (rgb: Rgb): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

function fromLch(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  for (let c = chroma; c > 0; c -= 0.002) {
    const rgb = oklabToRgb(lightness, c * Math.cos(radians), c * Math.sin(radians));
    if (inGamut(rgb)) return rgbToHex(rgb);
  }
  return rgbToHex(oklabToRgb(lightness, 0, 0));
}

function brandScale(name: BrandScale): Map<number, string> {
  const anchor = brandAnchors[name];
  const base = oklch(anchor.hex);
  const scale = new Map<number, string>();
  for (const step of brandSteps) {
    const lightness = brandLightness[step] ?? 0;
    const ease = Math.max(0.18, 1 - Math.abs(lightness - base.lightness) * 1.15);
    scale.set(step, fromLch(lightness, base.chroma * ease, base.hue));
  }
  scale.set(anchor.step, anchor.hex);
  return scale;
}

function greyScale(): Map<number, string> {
  const hue = oklch(brandAnchors.ocean.hex).hue;
  const scale = new Map<number, string>();
  for (const step of greySteps) {
    const lightness = greyLightness[step] ?? 0;
    scale.set(step, fromLch(lightness, lightness > 0.5 ? 0.014 : 0.022, hue));
  }
  scale.set(0, '#ffffff');
  for (const [step, hex] of Object.entries(greyAnchors)) scale.set(Number(step), hex);
  return scale;
}

export function colourScales(): ReadonlyMap<ScaleName, ReadonlyMap<number, string>> {
  return new Map<ScaleName, ReadonlyMap<number, string>>([
    ['inspire', brandScale('inspire')],
    ['ocean', brandScale('ocean')],
    ['cultivate', brandScale('cultivate')],
    ['kindle', brandScale('kindle')],
    ['grey', greyScale()],
  ]);
}

export function scalesCss(): string {
  const lines = [...colourScales()].flatMap(([name, steps]) =>
    [...steps].map(([step, hex]) => `  --uw-${name}-${step}: ${hex};`),
  );
  return `:root {\n${lines.join('\n')}\n}\n`;
}
