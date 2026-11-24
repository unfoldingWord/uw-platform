import { manifestColours } from '@uw/ui/generated/app-css';
import { markWhiteBase64 } from '@uw/ui/generated/mark';

const SIDE = 512;
const MARK = { width: 217, height: 340 };

export function iconSvg(): string {
  const x = (SIDE - MARK.width) / 2;
  const y = (SIDE - MARK.height) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}">`,
    `<rect width="${SIDE}" height="${SIDE}" fill="${manifestColours.panel}"/>`,
    `<image x="${x}" y="${y}" width="${MARK.width}" height="${MARK.height}" href="data:image/png;base64,${markWhiteBase64}"/>`,
    '</svg>',
  ].join('');
}
