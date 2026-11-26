import { RESOURCES_COLLECTION_KEY, WEBSITES_VIEW_ID } from './resource-ids.ts';
import type { VerbName } from './verb-names.ts';

const flow = [
  'The flow, by verbs and two buttons:',
  `1. Resources are rows of the collection ${RESOURCES_COLLECTION_KEY} (read_collection ${RESOURCES_COLLECTION_KEY} lists its views). Add a site with create_row {collection: "${RESOURCES_COLLECTION_KEY}", values: {kind: "website", address: "https://example.org/"}}. Record each site's canonical address, the one it answers at after its redirects: a run may reach only that address's own origin and its www. or bare sibling, so a site that redirects anywhere else is refused. Relate it to what it serves with set_property, property serves_project, serves_program or serves_portfolio, value a list of page ids, such as ["<project page id>"]. The Websites view is ${WEBSITES_VIEW_ID}; read_view lists its rows.`,
  '2. save_measure with values: [] and metrics: [], then ask the person to press Run trial on the measure page (/pages/<measureId>).',
  "3. read_measure_run (pass resourceId for one resource) lists the JSON pointers the trial's output holds, with a sample of each, including where the tool reports a failure for failure_path.",
  '4. save_measure again with values and metrics whose paths come from that outline; its problems name any value that does not read in the trial output. No second trial is needed.',
  '5. save_dashboard twice: one with context kind organization for every website, and one with context kind host to use as report_card; save_measure again naming that one as report_card.',
  '6. preview_dashboard draws each panel from the trial output with the current values and returns every problem.',
  '7. Ask the person to press Activate on the measure page. No verb starts a trial or activates.',
].join('\n');

const measureFields = [
  'Fields: package is name==exact.version, such as geo-optimizer-skill==4.19.10.',
  'command is the tool the package installs and its arguments, one per item, without uvx, uv or --from: the platform installs the package and runs the tool with uvx itself.',
  'A request to run `uvx --from geo-optimizer-skill==4.19.10 geo audit --url [url]` is package "geo-optimizer-skill==4.19.10" and command ["geo", "audit", "--url", "{address}", "--format", "json"].',
  '{address} is filled in with the resource address and {host} with its host; the tool must print JSON.',
  'A value path is an RFC 6901 JSON pointer into that JSON, such as /score or /categories/0/points (~1 stands for / in a key).',
  'failure_path is the pointer where the tool reports a failure while still exiting 0; anything there but null, false or empty text fails that observation, and its values are not kept. geo audit prints a score of 0 with an error when it cannot fetch a site, so a geo audit measure sets failure_path "/error".',
  `resources.view is a saved view of the ${RESOURCES_COLLECTION_KEY} collection, such as Websites ${WEBSITES_VIEW_ID}.`,
  'report_card is a dashboard whose context kind is host: it shows the page it is shown on, and appears on each project, program or portfolio page a measured resource serves.',
].join('\n');

const dashboardFields = [
  'context kind organization covers every resource of resource_kind; page covers the resources serving page_id (and its descendants when true); resources lists resource_ids; host takes the page the dashboard is shown on, and is the context a report card needs.',
  "Panels: figure, bars and trend show a metric; table shows values, each with an optional threshold; list shows one text_list value; status shows the measure's runs and coverage.",
].join('\n');

export const verbGuides: Readonly<Partial<Record<VerbName, string>>> = {
  save_measure: `${measureFields}\n\n${flow}`,
  save_dashboard: `${dashboardFields}\n\n${flow}`,
  read_measure_run:
    "Pass resourceId to read one resource in full. Each observation carries an outline: the JSON pointer of every scalar leaf and list of text in its output, with a sample, and the problems the measure's current values meet in it. Raw text is given whole when short; long JSON is never cut, its outline stands in. A failure the output reports at failure_path is named among the problems.",
  preview_dashboard:
    "Reads the trial output again with the measure's current values, as Activate will, and names each value that does not read, by resource. A dashboard whose context kind is host needs hostPageId.",
  run_measure:
    'Only for an active measure, at most once an hour. A trial is a person pressing Run trial on the measure page; activation is a person pressing Activate.',
};
