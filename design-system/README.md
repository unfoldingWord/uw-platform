# design-system

The uw-platform design system, drawn on a Claude Design canvas and synced here. ADR 0029 records the decision; this folder shows it. Code reads nothing from this folder, and nobody edits it by hand (AGENTS.md rule 4): a change is made on the canvas and synced again.

Canvas: https://claude.ai/artifact/GnXkSS47k4CVGpBzupSgFZ (private to its owner until shared).

## Boards

| File | Holds |
|---|---|
| `Main.dc.html` | Five principles, colour budget, the six text styles, spacing, depth, motion, and what adopting the system changes in the repository |
| `Components.dc.html` | Each part, the `packages/ui` export it becomes, and whether it is new or a revision |
| `Interactions.dc.html` | The four steps of disclosure (hint, menu, side panel, page), with a working Waiting On You demo |
| `Layouts.dc.html` | The frame and the five page shapes (List, Document, Form, Board, Overview), each with the screens that use it |
| `Today.dc.html` | Today drawn in the system, light and dark |
| `EditInPlace.dc.html` | Edit in place: a pencil per property or Edit for the page, nothing on the page moving |
| `canvas.json` | The canvas index: where each board sits |

The `.dc.html` files open on the canvas; outside it they need the canvas runtime (`support.js`), so read them as source or open the canvas link.

## What stays where

- Values: `packages/ui/tokens/`. Every colour, size and space on these boards is an existing token step; the boards write them as hex because the canvas cannot read the token files. The three motion values (120, 160 and 200 ms) are new and land in `effects.css` with the first part that uses them.
- Parts and shapes: `packages/ui/components/` and `packages/ui/shapes/`.
- Words: `CONTEXT.md` (Page shape, Side panel, Edit mode).
