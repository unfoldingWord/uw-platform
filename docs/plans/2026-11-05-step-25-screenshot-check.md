# Step 25: the screenshot check

| | |
|---|---|
| Spec | `docs/PRD.md`, section 7.12.2, UI-16; design `docs/specs/2026-11-04-harness-v0-3-0-design.md`, sections 1 and 10 |
| Requirements | UI-16 |
| Branch | `feat/ui-redesign` |
| Template | The nearest is a `*.pg.test.ts` view test (seeded fixtures through the app), with a browser added |

## Rulings

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R25-1 | **Playwright 1.60.0 with its headless Chromium** renders the pages; `pngjs` and `pixelmatch` compare them. The pictures live in `apps/uw-app/screens/pictures/`, one PNG per screen, theme and width | Playwright is the browser driver the organisation's other projects use; pixelmatch is the small, standard image diff | A Chromium upgrade changes antialiasing; the pictures are retaken with `pnpm screens:update` and looked at |
| R25-2 | **What varies between runs is fixed before the shot:** the clock is fixed by the fixtures, random ids are replaced with one fixed id, and the database latency is written as 0 ms. Icons are the Free build (ADR 0013) | A picture must change only when the look changes | A new varying value shows as a failure, which says so |
| R25-3 | **A shot matches when fewer than 0.5 percent of its pixels differ** beyond pixelmatch's default colour threshold | Font rasterisation differs slightly between machines with the same Chromium | A change that touches under 0.5 percent of a screen passes; the planted token test proves a real change fails |
| R25-4 | **The check needs its browser.** Locally it is skipped when Chromium is not installed and says so; in CI the `screens` job installs it and sets `UW_SCREENS=required`, so a missing browser fails rather than skips | DX-8 keeps `pnpm verify` free of installs; CI must not pass by skipping | A machine without Chromium does not run the check; CI always does |

## Tasks

1. The dependencies (`playwright` 1.60.0, `pngjs`, `pixelmatch`) and the `pnpm screens` and `pnpm screens:update` scripts.
2. `apps/uw-app/screens/screens.pg.test.ts`: seed the fixture worlds, render Home, Waiting On You, a gate, the Board, Flow, the play-by-play, a persona, Health and a Health detail, normalise them (R25-2), shoot each in light and dark at 1440 and 390 px wide, and compare with the committed pictures; with `UW_SCREENS_UPDATE=1` it writes them instead. A second test changes one token value in the stylesheet and expects the comparison to fail.
3. Shared root `.github/workflows/ci.yml`, its own commit: the `screens` job.
4. The pictures, taken last, and looked at.
5. Record; `pnpm verify` green; CI green.
