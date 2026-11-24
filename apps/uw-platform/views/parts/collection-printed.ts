import type { Context } from 'hono';
import type { AppEnv } from '../../deps.ts';
import type { Printed } from '../../pdf/print-document.ts';
import { canonicalJson, sha256Hex } from '../../pdf/provenance.ts';
import { viewFilters } from '../../pdf/view-filters.ts';
import { cursorOf, type CollectionScene } from './collection-scene.ts';
import { wantsPdf } from './frame.tsx';

export async function collectionPrinted(
  c: Context<AppEnv>,
  scene: CollectionScene,
): Promise<{ readonly printed?: Printed }> {
  const { stored, view, layout } = scene;
  if (!wantsPdf(c) || view === null || layout === null) return {};
  const { settings } = view;
  const params = {
    month: settings.layout === 'calendar' ? layout.month : null,
    cursor: cursorOf(c),
  };
  const rowIds = layout.reply.rows.map((row) => row.id);
  const sha256 = await sha256Hex(canonicalJson({ viewId: view.id, settings, params, rowIds }));
  return {
    printed: {
      reference: `${stored.definition.key}/${settings.name}`,
      filters: viewFilters(settings, stored.definition.properties, params),
      hashInput: { kind: 'hash', sha256 },
    },
  };
}
