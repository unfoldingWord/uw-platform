---
status: accepted
date: 2026-09-29
---
# Tailwind 4 over the brand tokens, with the design system as the source of truth

The web islands are styled with Tailwind 4, whose theme is defined in CSS from the unfoldingWord brand tokens rather than from Tailwind's defaults. The tokens live in `packages/ui/tokens/*.css`: the five brand colors (Ocean, Inspire, Cultivate, Kindle, Tech) with their soft tints, the neutrals, type (Nunito Sans with Avenir fallback, a monospace for identifiers), spacing, radius, and the dark theme. Light and dark follow the system setting with a persisted user override, through the `prefers-color-scheme` and `data-theme` pattern the Key Visuals page already uses. A check compares the Tailwind theme to the token files by name and value, so a value that is not in the tokens is a design change, not a code change.

Today the tokens' source is the CSS in the Claude Design prototype (`ui-design/parts/head.html`, removed from the repository on 2026-10-20 and kept in git history) and the Key Visuals page; there is no written brand guide in the repo, and the plan's one-line palette gives the dark-mode values for two colors. The prototype wins where they differ. The sponsor's intent is to turn the mockup into a design system in the shape `unfoldingWord/uw-app` has, a `design-system/` folder with token CSS, primitives with typed props and usage notes, a handoff document and a skill file. When it lands, it replaces the interim extraction and nothing in the islands changes but the import.

The alternative, hand-written CSS per island against the same variables, would work and would drift: every island would carry its own spacing scale and its own dark-mode branches. Tailwind's value here is not dark mode, which the tokens already provide, but one vocabulary for consuming them.

**Consequences.** Nothing hard-codes a hex value; the tokens-agree check fails the build if it does. Kindle orange marks a human action and nothing else, as the spec's figures do. The `uw-dev-skills` roadmap names Tailwind 4 as a coming shared skill, so this matches the org direction. Source: issue #46; the sponsor on Zulip, 2026-09-29.
