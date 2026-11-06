import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { freeGlyph, iconModule, iconNames, proGlyph, type IconPack } from './icons.ts';

const target = new URL('../../packages/ui/generated/icons.ts', import.meta.url);
const load = createRequire(new URL('../../packages/ui/package.json', import.meta.url));

function pack(name: string): IconPack | null {
  try {
    return load(name) as IconPack;
  } catch {
    return null;
  }
}

function freeModule(): string {
  const packs = [
    pack('@fortawesome/free-regular-svg-icons'),
    pack('@fortawesome/free-solid-svg-icons'),
  ].filter((found) => found !== null);
  const free = (name: string) => freeGlyph(name, packs);
  return iconModule(iconNames, free, free);
}

function proModule(): string {
  const regular = pack('@fortawesome/pro-regular-svg-icons');
  const duotone = pack('@fortawesome/pro-duotone-svg-icons');
  if (regular === null || duotone === null) {
    console.error('The Font Awesome Pro packages are not installed; drawing Free.');
    return freeModule();
  }
  return iconModule(
    iconNames,
    (name) => proGlyph(name, regular),
    (name) => proGlyph(name, duotone),
  );
}

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== freeModule()) {
    console.error('packages/ui/generated/icons.ts is not the Free build. Run pnpm ui:icons.');
    process.exit(1);
  }
  console.log('packages/ui/generated/icons.ts is the Free build.');
} else {
  writeFileSync(target, process.argv.includes('--pro') ? proModule() : freeModule());
  console.log('Wrote packages/ui/generated/icons.ts.');
}
