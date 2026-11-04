---
status: accepted
date: 2026-11-04
---
# One token system, generated from the brand colours and locked in Tailwind

The screens use one set of tokens and nothing else: colour scales computed in OKLCH from the five brand colours, with each brand hex exact on its step (Inspire 400, Ocean 800, Cultivate 300, Kindle 400) and a grey tinted toward Ocean; roles that name a job (`--surface`, `--text-3`, `--human`) mapped per theme to one step of a scale; eight type sizes and three weights; eight spacing steps (4 to 64 px); four radii; five shadows; and named layout widths. The values are section 5 of `docs/superpowers/specs/2026-11-04-harness-v0-3-0-design.md`. Every text role on every surface role passes WCAG AA, 4.5:1, in both themes, and a test says so. Nunito Sans and JetBrains Mono are bundled with the Worker, because the content security policy is `font-src 'self'`.

The token scales are the whole Tailwind theme. Tailwind's default spacing (any multiple of 4 px) is cleared like its colours already are, so `gap-7` does not exist. A check fails the build on any arbitrary value in a class (`p-[18px]`, `text-[13px]`, `rounded-[14px]`) and on a raw colour, size or shadow outside the token files.

**What changes in ADR 0007.** Tailwind 4 over the brand tokens stands, and so does Kindle marking a human action and nothing else. What changes is the source and the reach of the tokens: the source is no longer the prototype's CSS and the Key Visuals page, it is the generated scales; and the check no longer stops at hex literals, it covers every value a screen can choose. The intent that a `design-system/` folder from Claude Design replaces the token files when it lands stands unchanged.

**Why.** The prototype's tokens gave one colour and one tint per brand colour, three greys, one spacing unit and no shadows. With nothing to choose from, every screen chose for itself: the ten mockup rounds that designed v0.3.0 accumulated 25 font sizes, 24 spacing values, 58 hex colours and 42 shadows before they were measured. Refactoring UI's rule is to define the system first and then use only it; the lock is what makes the rule hold after the people who wrote it have moved on.

**Rejected.** Hand-picked shades per screen, which is the state measured above. Tailwind's default palette and spacing, which are not the brand. A published palette such as Radix Colors, which would need its hues retoned to the brand and so be generated anyway. Leaving arbitrary values allowed and reviewing for them, which is the review that did not happen in v0.1.0 and v0.2.0.

**Consequences.** A new value is a design change: it is added to the token files and the spec in the same commit, or it does not compile. The screenshot check (PRD UI-16) shows what a token change does to every screen. Source: Ian on 2026-11-04, after measuring the mockup.
