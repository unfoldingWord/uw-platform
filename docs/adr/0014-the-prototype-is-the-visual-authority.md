---
status: accepted
date: 2026-11-12
---
# The prototype is the visual authority; its values snap to the token scales

The screens look like Jesse Griffin's Claude Design prototype (`ui-design/`, removed from the repository in `9a4955e` and still in git history). It sets the layout, the parts and the colour use: an Ocean sidebar grouped by area code with the white unfoldingWord logo, a white top bar with the area code and breadcrumb, a pale canvas of bordered cards with a header and a body, small uppercase labels, compact badges and chips, figure cards with an accent top rule, and pale lanes of compact cards. The v0.3.0 design document (`docs/specs/2026-11-04-harness-v0-3-0-design.md`) stops being the authority for how a screen looks; it still explains what each screen holds.

ADR 0011 stands. The token scales and the lint lock do not change. Where the prototype uses a value off a scale (13.5, 12.5, 10.5 and 9.5 px type, weights 700 and 900, 11 px padding, 262 px sidebar), the screen uses the nearest token instead: 14, 13 and 12 px, weight 800, 12 px, the 248 px sidebar. Only the theme roles move: the sidebar takes Ocean with its own text roles, and lanes, cards and soft row lines get roles of their own. Every new pair is in the contrast test.

The prototype has no dark theme and no phone layout. Dark keeps the same structure with the sidebar one Ocean step deeper, a near-black canvas tinted toward Ocean, cards a step lighter, and soft fills from the darkest tint of each brand colour. On a phone the sidebar becomes an Ocean header whose menu opens the same list; lanes keep their width and scroll; figure cards go two across. Icons stay Font Awesome (ADR 0013), each prototype icon mapped to the nearest name.

The sidebar is the prototype's, area by area. Today (was Home), Health and Agent Queues are built; each workflow sits under Agent Queues. Every other module the prototype shows appears in place with its prototype label and a "Coming Soon" pill, and opens nothing. Waiting On You leaves the sidebar; its count sits on Today and its page opens from Today's "Waiting on me" card.

| Harness screen | Prototype counterpart |
|---|---|
| Frame: sidebar and top bar | The frame shared by every prototype screen |
| Status bar | None; the dashed provenance strip under the prototype's cards |
| Phone header | None; worked out as above |
| Today | Today (`Main`) |
| Board | Agent Queues lanes and cards, with Development's chips and view switch |
| Flow | Agent Queues "Stage configuration" |
| Waiting On You | Today's "Waiting on me" rows |
| Gate decision | Health's "Open alert" card |
| Play-by-play | Agent Queues "What the run did" |
| Persona | Agent Queues, agents |
| Health and Health detail | Health |

**Why.** The v0.3.0 redesign drifted from the prototype, and the result was not what the sponsor wanted (#97). Ian chose the prototype's look but not its values: "we need to conform to our design rules." The token lock is what stops screens drifting apart again; giving it up to match the prototype pixel for pixel would undo the reason for ADR 0011.

**Rejected.** Replacing the scales with the prototype's own values, which would bring back the unmanaged values ADR 0011 measured. Dropping the lock and writing values by hand. Drawing the prototype's own line icons in place of Font Awesome, which Ian declined. Leaving dark and phone as they were in v0.3.0, which would make the two themes look like two products.

**Consequences.** A screen that differs from the prototype by less than a token step is correct. A new screen starts from its prototype counterpart, or the closest one, and records which. The screenshot check (PRD UI-16) holds the pictures of this look. Source: Ian on 2026-11-12, issue #97.
