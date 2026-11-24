import { manifestColours } from '@uw/ui/generated/app-css';

export function manifest() {
  return {
    name: 'unfoldingWord',
    short_name: 'unfoldingWord',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: manifestColours.theme,
    background_color: manifestColours.background,
    icons: [
      { src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  };
}
