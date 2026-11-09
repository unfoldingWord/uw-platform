# Step 22: the frame and names

| | |
|---|---|
| Spec | `docs/PRD.md`, sections 7.12.2 and 8.6; design `docs/specs/2026-11-04-harness-v0-3-0-design.md`, sections 4.1 and 7 |
| Requirements | UI-5, UI-17, UI-18 |
| Branch | `feat/ui-redesign` |
| Templates | UI-18: "New table or column", "New event" and "New command" (rule 1), copied from `set_fix_claim` (step 17), whose every file is the checklist below. UI-5: "New screen", for the frame every screen shares. UI-17: the nearest is `tools/ui/copy.test.ts` |

## Tasks

1. **UI-18, contracts** (shared root `packages/contracts/`, its own commit). `harnessSchema` gains `title` (a trimmed string, 1 to 80 characters). The command `set_title` with body `{ title }`; `activate_template` gains an optional `title`. The event `title_set` with strict evidence `{ from, to }`. Valid and invalid fixtures beside `set-fix-claim.json` and `fix-claim-set.json`; the contract's next minor version and its lock entry.
2. **UI-18, schema** (shared root `packages/db/schema.ts`, its own commit). `harnesses.title`, text, not null, no default. Migration `0040_harness_title.sql`: add the column nullable, `update harnesses set title = key`, set not null. A test in `packages/db` that the backfill gives every existing row its key, and that an insert without a title is refused.
3. **UI-18, the Store and the kernel.** `HarnessesGateway.write.setTitle(harnessId, title)` in `store-ports.ts` and `packages/db/store/harnesses.ts`, with a Store contract case. `packages/harness/stages/title.ts`, `setTitle` copied from `fix-claim.ts`: agent refused, admin of the harness's area required, a no-op when unchanged, `title_set` recorded with `{ from, to }`. `activate.ts` inserts `title: input.title ?? input.key`. The fold ignores `title_set`. The command handler in `apps/uw-app/commands/person/stages.ts` and the registry. Scenario `UI-18` in `sim/scenarios/`, kernel tests for the insert with and without a title and for `set_title` refused to an agent and to a non-admin.
4. **UI-17, Title Case.** A test over the frame's navigation labels and every screen's page title: every word capitalized, "unfoldingWord" excepted; and the tracker records the copy rule's test.
5. **UI-5, the frame.** The sidebar, top bar, status bar and phone header of design section 4.1, in `packages/ui/components/` (sidebar, top bar, status bar) and `apps/uw-app/views/parts/frame.tsx`. Harness names are titles. Every count and every status bar value comes from a read that exists; where none exists yet (My Items, the person's held items, is UI-15's read in step 23), the control says it is not wired, never silence. The unfoldingWord mark is the brand guide's Logo Mark, scaled (never cropped or recoloured) and served from the Worker like the fonts. The search box is drawn and says it is not wired (design section 11).
6. **Record.** Tracker row 22 with the evidence; `pnpm verify` green.
