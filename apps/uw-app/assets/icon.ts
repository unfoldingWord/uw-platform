import { manifestColours } from '@uw/ui/generated/app-css';

export function iconSvg(): string {
  const { panel, panelInk } = manifestColours;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    `<rect width="512" height="512" fill="${panel}"/>`,
    `<text x="256" y="256" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="240" font-weight="700" fill="${panelInk}">uW</text>`,
    '</svg>',
  ].join('');
}
