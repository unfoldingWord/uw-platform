import { mapRelationSchema, type EntityCounts, type MapRelation } from '@uw/contracts';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import type { CascadeNode } from '../../crosswalk/nodes.ts';
import { areaLabel, pageNames } from './names.ts';
import { crosswalkPath } from './paths.ts';

const ENDPOINT = '/api/crosswalk/commands';
const NOTE_MAX = 280;

const relations: ReadonlyMap<MapRelation, string> = new Map([
  ['owns', 'Owns'],
  ['supports', 'Supports'],
  ['funds', 'Funds'],
  ['reports_on', 'Reports on'],
]);

const tiers: ReadonlyMap<string, string> = new Map([
  ['portfolio', 'Portfolio'],
  ['program', 'Program'],
  ['project', 'Project'],
  ['unplaced', 'Not placed'],
]);

export function relationWord(relation: MapRelation): string {
  return relations.get(relation) ?? relation;
}

export function tierWord(tier: string): string {
  return tiers.get(tier) ?? tier;
}

const relationChoices = mapRelationSchema.options.map((value) => ({
  value,
  label: relationWord(value),
}));

export function DeclareForm(props: {
  readonly areas: readonly string[];
  readonly nodes: readonly CascadeNode[];
}) {
  const areas = props.areas.map((area) => ({ value: area, label: areaLabel(area) }));
  const nodes = props.nodes.map((node) => ({
    value: node.id,
    label: `${tierWord(node.tier)} · ${node.title}`,
  }));
  if (nodes.length === 0) {
    return <p class="m-0 text-sm text-text-2">There is no portfolio, program or project yet.</p>;
  }
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command="declare_jd_map"
      scope="new"
      done="Declared. The crosswalk below shows it."
    >
      <SelectField name="jdArea" label="Area" scope="new" choices={areas} />
      <SelectField name="relation" label="Relation" scope="new" choices={relationChoices} />
      <SelectField name="cascadePageId" label="Cascade node" scope="new" choices={nodes} />
      <TextField name="note" label="Note" scope="new" maxLength={NOTE_MAX} />
      <HumanActionButton itemId="new" label="Declare" name="decision" value="declare_jd_map" />
    </PlatformCommandForm>
  );
}

export function RemoveForm(props: { readonly mapId: string; readonly what: string }) {
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command="remove_jd_map"
      scope={props.mapId}
      done={`Removed: ${props.what}.`}
      inline
    >
      <input type="hidden" name="mapId" value={props.mapId} />
      <HumanActionButton
        itemId={props.mapId}
        label="Remove"
        name="decision"
        value="remove_jd_map"
      />
    </PlatformCommandForm>
  );
}

export function countWords(counts: EntityCounts): string {
  const parts = [
    [counts.pages, 'page'],
    [counts.tasks, 'task'],
    [counts.items, 'item'],
  ] as const;
  const shown = parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? '' : 's'}`);
  return shown.length === 0 ? 'None' : shown.join(' · ');
}

export function crosswalkCrumbs(last: string) {
  return [
    { label: 'unfoldingWord Home' },
    { label: pageNames.crosswalk, href: crosswalkPath() },
    { label: last },
  ];
}
