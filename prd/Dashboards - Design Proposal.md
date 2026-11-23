# Dashboards and Agent Authoring Design Proposal

**Status:** proposed. This document specifies a future capability; it does not add a page type, runtime, data connection or publishing permission.
**Date:** 2026-11-20
**Issue:** [#189](https://github.com/unfoldingWord/uw-platform/issues/189)

Add a `dashboard` page type that can be filed anywhere in the platform hierarchy and displayed inside another page. A reusable definition supplies the presentation; each dashboard page supplies its context. Infrastructure can see all permitted websites while a program overview shows that program's websites through the same definition. Mobile app downloads use the same framework with their own dataset and metric definitions.

The platform owns the source, data contracts, versions and share links. Agents create dashboards through a documented contract with validation and preview. Opening a dashboard requires no AI model call or Claude account.

## 1. The first uses

| Location | Reusable definition | Context | Display |
|---|---|---|---|
| Infrastructure / Site Health | Site GEO | All permitted websites | Full dashboard |
| BT Servant / Overview | Site GEO | Websites associated with BT Servant | Summary embedded in the overview |
| Organization / App Downloads | Mobile Downloads | All permitted mobile apps | Full dashboard |
| A program or project / Overview | Mobile Downloads | Apps associated with that program or project | Summary embedded in the overview |

Changing a chart in a definition produces a new definition version that these pages can adopt. Attaching a dashboard to another place creates configuration and relationships, without copying its code or source data.

A program overview can embed several dashboard pages, such as site health and downloads. Each embed opens its full dashboard with the same context and selected filters.

## 2. Proposed vocabulary

These terms should enter `CONTEXT.md` before implementation. They do not change the existing meaning of the platform's Home, Persona view or workflow screens.

| Term | Meaning |
|---|---|
| Dashboard definition | A reusable, versioned description of a dashboard's presentation, declared data requirements, parameters and supported displays. |
| Dashboard page | A page of type `dashboard` that binds one definition version to a context and saved settings. |
| Dashboard embed | A reference displaying a dashboard page inside another page. It retains the referenced dashboard's context and permissions. |
| Dashboard context | The explicit set of resources a dashboard describes, selected directly or resolved from a page and its relationships. |
| Resource | A measured thing with a stable identity, such as a website or a mobile app. |
| Dataset | A versioned, documented set of observations provided by an approved platform adapter. |
| Metric | A named calculation with a defined unit, observation grain, time meaning and aggregation rule. |

One definition can serve many dashboard pages. One dashboard page has one filing parent and can have many embeds. Embedding or linking does not give a page multiple parents.

## 3. Hierarchy and context

The [platform plan's entity spine](An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md#2-core-data-model--pages--records) describes a parent tree and additional relationships for products serving multiple programs. Use those stable page identities and relationships for dashboard context. The functional Johnny.Decimal filing location and the program/project described by a dashboard are separate properties.

Support three context selectors:

- **Organization:** all resources of the definition's supported kinds that the reader may access.
- **Page:** resources associated with a named page, optionally including its descendants and declared relationship kinds.
- **Resources:** an explicit set of resource IDs, useful for a comparison or fixed report.

The selector is saved configuration. Creating a dashboard from a program overview may prefill that program's ID, but runtime reads never guess context from a title, URL, DOM ancestor or filing parent. Moving a dashboard preserves its context; changing context is an explicit, versioned edit.

Website and app associations must exist independently of the renderer. Register the existing resource once, preserve external identifiers, and associate it with the pages it serves. A website can serve two programs; an app can belong to a product whose projects sit under different programs. Resolve the selected relationships, then deduplicate resource IDs before reading or aggregating observations. Organization totals count each resource once even when program views overlap; program totals must not be added together to reconstruct an organization total.

An embed uses an existing dashboard page. To show the same definition for another program, create another dashboard page with that program's context. A summary/full display option changes presentation only. It does not change scope. An embed can narrow filters where the definition permits; it cannot broaden the saved context or the reader's access.

## 4. Data and metric contracts

Definitions request registered datasets and metrics by versioned keys. They cannot supply arbitrary SQL, repository paths, remote URLs or credentials. Platform adapters own fetching and normalization; the existing module owning a business fact remains its writer. Dashboards read facts and compute views rather than maintain a second business database.

A dataset contract declares its fields and types, stable resource identity, observation grain, time zone and date rules, units, supported filters, freshness expectation, source lineage and applicable read policy. A metric contract declares how it treats missing observations, errors, duplicates, time ranges and aggregation across resources. Unknown fields, unsupported filters and incompatible contract versions are validation failures.

Every result includes the resolved context, authorized scope coverage, source observation time, retrieval time, dataset/metric versions and source revision or snapshot ID. States include loading, ready, empty, stale, partial failure and unavailable. Missing or failed observations are never converted to zero. Coverage labels must not reveal the identities or counts of resources the reader cannot access.

### Site GEO

The [existing runner](https://github.com/unfoldingWord/geo-audit/blob/main/geo_audit_all.py) writes audit time, site, score, scoring version, category percentages, recommendations and error state. Its [workflow](https://github.com/unfoldingWord/geo-audit/blob/main/.github/workflows/geo-audit.yml) produces latest results and appended history.

Normalize each site to a registered website ID. A current score uses the latest applicable observation per website, with failed or missing results shown explicitly. An average uses valid observations and states its coverage. Site scores are not summed. Trend comparisons must retain the scoring version; a changed scoring rubric is marked as a break or displayed separately. The target of 90 belongs to the metric's documented policy and is labelled wherever used.

### Mobile downloads

Inventory the existing downloads dashboard and source before defining its adapter. Record whether a figure means downloads, first-time downloads, installs, active devices or another measure. Identify store, app, geography, time zone, reporting lag and whether rows are interval counts or cumulative snapshots.

Daily counts may be summed over distinct compatible observations. Cumulative snapshots must not be summed across dates; a period change is derived only where the source definition supports it. Store-specific measures remain separate unless the metric documents a valid combination. Resource associations and deduplication follow the same rules as website observations.

## 5. Portable definition and page contracts

Publish the contracts from `packages/contracts` as Zod schemas, generated machine-readable schemas, examples and golden fixtures. Follow the repository's one-live-contract-version convention: the manifest identifies its contract version and unsupported versions are refused or explicitly migrated. Definition revisions remain immutable content versions, independent of the live protocol version.

The following YAML illustrates the proposed field vocabulary; the implementation must supply the validating schemas and fixtures before agents can use it.

```yaml
schema: uw.dashboard/v1
key: site-geo
revision: 1
renderer: native
resourceKinds: [website]
datasets:
  scores: geo-audit.scores/v1
displays: [summary, full]
parameters:
  historyDays:
    type: integer
    minimum: 1
    maximum: 365
    default: 90
widgets:
  - id: sites-meeting-target
    kind: metric
    dataset: scores
    metric: geo.sites-meeting-target/v1
  - id: scores-by-site
    kind: bar
    dataset: scores
    metric: geo.latest-score/v1
    groupBy: resource
  - id: score-history
    kind: line
    dataset: scores
    metric: geo.score-history/v1
    groupBy: resource
```

A dashboard page references that immutable definition revision. Its ordinary page fields still carry title, filing parent, Johnny.Decimal area, status and version. Its typed frontmatter contains the binding:

```yaml
type: dashboard
definition:
  key: site-geo
  revision: 1
context:
  kind: page
  pageId: 00000000-0000-4000-8000-000000000001
  includeDescendants: true
parameters:
  historyDays: 90
display: full
```

The example ID is a fixture placeholder. Real bindings use resolved page UUIDs. Definitions declare the relationship kinds used to find their resource kinds; page authors choose from supported contexts and parameters. The server validates the binding and refuses incompatible resource kinds, unsupported parameters and unbounded queries.

The Markdown body carries purpose, metric explanations and source notes for readers, search and agents. Executable HTML is stored as a separate bundle. The ordinary wiki renderer remains sanitized.

## 6. Agent authoring framework

The framework supplies a small author interface and hides the platform work behind it: context resolution, authorization, source fetching, aggregation rules, caching, theming, responsive rendering, errors, lineage, versions and export.

Deliver the following together:

| Deliverable | What it lets an agent do |
|---|---|
| Contract schemas and fixtures | Generate valid definitions and bindings without guessing fields or capabilities. |
| Dataset and metric catalog | Discover permitted sources, fields, units, freshness, filters and aggregation rules. Catalog discovery checks the caller's access. |
| Native widgets | Compose metric values, line/bar charts, tables and filters with platform tokens and accessible values. |
| HTML authoring SDK | Receive prepared data and host display settings through the same versioned contract. |
| Local preview and validator | Run against fixtures without production accounts; receive errors naming the field and supported values. |
| Authoring skill | Follow one procedure for creating a definition, attaching it, validating it and requesting the necessary human decisions. |
| MCP reads and draft commands | Discover contracts, resolve permitted contexts, validate, preview and save drafts through the existing verb registry. |

The authoring procedure is:

1. Discover the available datasets, metric definitions, reusable dashboard definitions and candidate context. Finish when the requested figures have documented sources, units and aggregation rules. If a source is missing, identify the adapter needed rather than invent a dataset.
2. Create or revise a definition and bindings against the current schemas. Finish when every widget references compatible registered data and every parameter has a bounded type and default.
3. Validate and preview with organization, program and project fixtures, including empty, stale and failed-source cases. Finish when the validator passes and each preview states its context, values and freshness.
4. Save a draft through an authorized command using expected-version checking and the request ledger. Finish when the saved revision and preview match the submitted content.
5. Present the definition and intended attachments for the human decisions required by policy. Finish when the person can inspect the exact revision, context, sources and sharing consequences.

An agent can draft and request decisions. Approval, activation of executable content, external publication and privilege changes remain person-only commands; they are not added to the MCP verb registry. A general page write cannot bypass these decisions. A person can attach an already-approved reusable definition within the scopes they may write, subject to its approved uses. A new source adapter is reviewed platform code.

## 7. Rendering and interaction

The native renderer maps the structured widgets to `packages/ui` and the existing [ECharts SVG decision](../docs/adr/0012-charts-are-echarts-svg.md). Values also appear as accessible text or tables. Widgets use the shared tokens, light/dark themes, responsive sizes and existing action-color rules. Definition files cannot inject arbitrary chart callbacks or scripts.

A custom HTML renderer supports artifacts requiring a custom presentation. A portable bundle contains an entry HTML file, packaged assets, manifest and source provenance. The SDK receives only validated datasets, context, parameter values, theme, locale/date settings and summary/full display mode. It offers narrowly defined interactions such as requesting a permitted filter change or opening an authorized drill-through. It exposes no platform session, broad command interface, database access or secret. Saved state uses explicit host commands, not an artifact's private business store.

Serve custom bundles from an isolated origin in a sandboxed viewer. Give the parent a precise frame-origin allowance while retaining its script restrictions. Enforce runtime restrictions on the serving response as well as the embed, including direct navigation to the bundle. Validate message schemas and the bound frame/channel; an opaque sandbox origin is not an identity check. Block undeclared network access and package dependencies so a renderer cannot silently depend on Claude-hosted assets. Production HTML uses the approved design tokens and passes the same display checks as native dashboards.

Both renderers show context, filters, source freshness and available actions. A failed source remains visible in place. An embedded card opens the full dashboard without changing its meaning.

## 8. Access and sharing

Context selects relevant resources; it never grants access. On every read, the server checks the dashboard page, definition availability, context metadata and source data under the current principal. It intersects the requested resource set with permitted source observations before aggregation or serialization. The browser never receives all rows for later filtering. Filters and drill-throughs remain bounded by that result and are reauthorized on each request.

An approved data-free definition may be reusable across areas without granting access to its owning area's authoring pages or data. A program reader can run that definition through a local dashboard page while Infrastructure retains its authoring ownership. Draft source configuration and private source notes are not included in the reusable runtime package. Reuse approval names the permitted uses; it cannot widen source grants.

Embeds check both the containing page and the referenced dashboard. Transclusion cannot transfer permissions. Private bundles, dataset results and exports all follow the same policy; caches must not reuse one principal's permitted data for another reader. Revoking a grant affects the next read, including a refresh, download or drill-through. Classification must be enforced by the source read; the open [classification-aware reads issue](https://github.com/unfoldingWord/uw-platform/issues/155) means a metadata label alone is insufficient.

Support internal links and explicitly approved public publication. Public delivery follows the [planned publishing flow](An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md#7-website-publishing): an authorized person approves the exact definition, page version, resolved context and public data, with a recorded publication. A public view receives only its approved projection. Parameter changes cannot expose additional resources or private metadata. An internal link below the current authenticated app does not become public by changing its URL.

Unlisted links can follow as a separate, revocable bearer-link policy: anyone with the link can read the published projection. They are not equivalent to internal access.

## 9. Versions, live views and export

Track definition revision, dashboard page version, dataset/metric contract versions and data snapshot/source revision separately. Pin a dashboard page to a definition revision; adopting another revision is a validated, versioned change. Compatibility failures are explicit. A definition edit does not silently replace published executable content.

A live view advances only its approved data feed and scope policy. Label it live and show its source observation time. A frozen report pins the definition, binding, parameters, resolved resource set and data snapshot. Pinning HTML while reading a changing JSON file does not freeze a report. Changes to source associations affect live views according to their selector, while frozen reports retain their recorded resource set.

Downloads include the definition or HTML bundle, packaged assets, approved data snapshot, binding, source provenance, contract versions and hashes. Exports obey the same read policy and exclude credentials and unauthorized data. The portable snapshot runs without the platform; refreshing live data requires a compatible authorized host. Retirement prevents new use while preserving authorized history; unpublishing stops future hosted delivery but cannot recall downloaded copies.

## 10. Fit with the current repository

The baseline is `develop` at `6ffde9c6`. The [current page registry](../packages/contracts/page-types.ts), [page schema](../packages/db/schema-platform.ts) and [security policy](../apps/uw-app/http/security-headers.ts) provide typed pages, page versions and a restrictive runtime policy. They do not yet provide the dashboard type or this framework. The strategic program/project hierarchy described in the plan is broader than the implemented page-type registry; start with stable page IDs without claiming those future entity types already exist.

Coordinate with [#175](https://github.com/unfoldingWord/uw-platform/issues/175) and [#172](https://github.com/unfoldingWord/uw-platform/pull/172) for wiki navigation, typed page reads, files, R2 and embeds. Per-page sharing is outside that knowledge-base issue's scope. Dashboard execution and publication need their own implementation work. `uw-www` is planned rather than an existing public dashboard host.

| Location | Proposed responsibility |
|---|---|
| `packages/contracts` | Definition, binding, result, command and event schemas; registry discovery; fixtures. |
| `packages/core` | Existing principal, dates and access rules reused by the dashboard capability. |
| Dashboard module and ports | Pure validation, context selection and metric interpretation; adapters for data and files; interface tests. Keep dashboard state separate from workflow state. |
| `packages/db/schema-*.ts` and migrations | Typed definition revisions, bindings, associations and publication records where durable records are needed, with one owner per table. Reuse existing pages/files identities. |
| `packages/ui` | Native widgets, accessible values and dashboard page/embed rendering. |
| `apps/uw-app` | Authorized reads, person commands, MCP draft handlers, preview and adapters. |
| `infra` | Private storage, isolated bundle delivery and public delivery declarations. |
| Authoring skill and examples | Contract discovery procedure, fixtures and local preview instructions. |

The module owns dashboard configuration and derived views; source modules keep ownership of observations and business facts. Do not add dashboard columns to workflow items or put unrelated dashboard events in `harness_events`. Runtime implementation should record ownership, classifications and offline eligibility before adding tables. Approved code packages can be cached; private datasets must not inherit the current page registry's blanket sync behavior without a data-specific decision.

## 11. Migration and implementation sequence

1. **Contracts and examples.** Add proposed vocabulary to `CONTEXT.md`, schemas, metric definitions and fixtures for GEO and downloads. Settle actual downloads semantics. Ship validation and preview before relying on generated manifests.
2. **Context and native pages.** Add resource associations, permission-filtered reads, the dashboard page type, shared widgets and overview embeds. Prove one definition serves organization, program and project contexts with no code duplication.
3. **Portable HTML.** Add the isolated viewer and SDK against the same contracts. Recover or recreate the GEO frontend and check it into an unfoldingWord-owned source repository. Its inspected Claude Sources panel uses Cartographer's `read_repo_file` for `unfoldingWord/geo-audit` at `results/geo-history.json`; replace that host-specific query with the approved adapter. Preserve the existing Actions data producer and its Run audit link initially. Audit other artifacts for host-specific queries and runtime assets before import.
4. **Agent authoring.** Publish the authoring skill, discovery, validation, preview and draft commands through the existing registry. Test the complete procedure with a new definition created from the examples and no production credentials.
5. **Sharing and migration.** Add approved public delivery, frozen reports, complete export and revocation behavior. Migrate the existing dashboards; retain source lineage and compare their results against the original datasets.

Each implementation slice needs its own scoped issue and checks. Public sharing is part of the intended outcome, not supplied by the initial internal page slice. Initial source bundles can stay in their data-producing repositories, such as `geo-audit`; freestanding tools can share an unfoldingWord-owned artifacts repository. Registration resolves a source commit and immutable bundle rather than executing whatever a moving branch currently contains.

## 12. Acceptance scenarios

Implementation is complete when these are proven at the public interfaces:

1. Infrastructure's GEO dashboard and a program's summary use the same definition revision and show the expected resource sets. A project view works through the same contract.
2. One resource linked to two programs appears in each program view and once in the organization view. Moving a dashboard's filing parent changes neither its context nor source permissions.
3. A reader with access to one program cannot obtain another program's rows, names or hidden-resource counts through filters, aggregates, embeds, exports, caches or direct asset requests. Grant revocation takes effect on the next read.
4. Daily-download fixtures aggregate correctly; cumulative fixtures are not summed across dates. GEO fixtures preserve scoring versions and distinguish an audit failure from a score of zero.
5. An agent discovers contracts, creates and validates a definition, previews it across contexts and saves a draft. Unknown datasets and incompatible versions fail with actionable errors. The agent cannot activate executable content or publish through a page write or MCP call.
6. Both dashboard families render as full pages and overview summaries in light/dark themes at phone width, with keyboard controls, accessible values and visible loading, empty, stale and failure states.
7. A custom HTML artifact cannot read parent credentials, invoke privileged commands or send undeclared network requests, including when its serving URL is opened directly.
8. A published frozen report retains its exact data after later audits and definition edits. A public live view advances only its approved feed; changing filters cannot widen its published scope. Unpublishing blocks future hosted reads.
9. An authorized download contains complete source/assets and the approved data snapshot, and runs independently without Claude or a model call. It exposes no private connection configuration.

## 13. Tradeoffs and decisions for implementation

Use structured native definitions for the common cases and portable HTML for custom presentations. The native path makes consistent behavior easy to generate and validate; HTML preserves the existing artifact workflow at the cost of an isolated runtime and a stricter capability contract. Both must consume the same prepared data and scope rules.

Keep definitions reusable and dashboard bindings local. Copying HTML for every program would make fixes drift; a multiple-parent page tree would confuse filing and access. Explicit bindings plus ordinary embeds keep reuse separate from ownership.

Before coding, choose the resource-association storage alongside the hierarchy work, specify which human roles approve reusable executable definitions and cross-area reuse within existing access rules, and settle the public delivery origin and revocation/cache policy. Record accepted architectural decisions in ADRs at implementation time. This proposal supplies the intended behavior and acceptance bar without presenting these capabilities as already implemented.
