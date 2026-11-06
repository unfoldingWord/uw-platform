---
status: accepted
date: 2026-11-04
---
# Charts are Apache ECharts 6, drawn as SVG

The harness's charts (Health's 30 days of runs and gate waits, and the sparklines on Home and the Persona screen) are drawn with Apache ECharts 6.1 using its SVG renderer, configured as `bt-servant-telemetry` configures its `TrendChart` and `Sparkline`: no animation, hairline grid lines, small axis labels in `--text-3`, an axis tooltip, bars for daily counts and lines for rates. Colours come from the token roles, read at render time, never from literals.

The chart is rendered on the server into the page's HTML where ECharts' server-side SVG rendering works inside the Worker and its output passes the content security policy (`style-src 'self'`, no inline styles). Where either fails, the chart is an island that renders the same SVG in the browser, and the figure it shows is also in the page as text, so the number is never only in a script. The first task of build step 21 is the spike that decides which, and records the result in `docs/progress_tracker.md`.

**Why.** unfoldingWord's other dashboard, `bt-servant-telemetry`, already uses ECharts 6.1 (through a Svelte wrapper this repository does not need); using the same library and settings keeps the organisation's charts alike and lets one person's knowledge carry. SVG suits the light and dark themes and server rendering suits Hono's server-rendered pages.

**Rejected.** Hand-written SVG, which the mockup used for four rounds and which grows a private charting library. Chart.js and uPlot, which draw on a canvas in the browser only. Recharts, which needs React. The Svelte wrapper, because the islands are plain TypeScript.

**Consequences.** One new runtime dependency, imported only by the chart component in `packages/ui`, tree-shaken to the line and bar series, the grid, the tooltip and the SVG renderer. Its size is measured in the spike and recorded with the dependency in the tracker.
