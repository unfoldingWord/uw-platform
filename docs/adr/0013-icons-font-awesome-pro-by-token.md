---
status: accepted
date: 2026-11-04
---
# Icons are Font Awesome Pro, installed with a token and never committed

Every icon on a screen comes through one icon component in `packages/ui`, by name. When the Font Awesome Pro packages are installed (Regular for the interface, Duotone for large tiles such as Home's task icons), the component draws them. When they are not, it draws the nearest Font Awesome Free icon for the same name, and a name with no free equivalent draws a neutral placeholder of the same size. The Pro packages are installed from Font Awesome's registry with a token held as a GitHub secret and a Cloudflare build secret; the token is never in a file in this repository, and neither is any Pro icon's artwork.

The build, every test and the screenshot check pass without the token (PRD DX-8), and the committed screenshots are taken with the free fallback so CI can reproduce them. Production and staging builds that hold the token draw Pro.

**Why.** The approved look uses Font Awesome Pro Regular; unfoldingWord holds a Pro licence, used by `bt-servant-web-client`. This repository is public, and the Pro artwork may not be published in it.

**Rejected.** Committing the SVG paths of the thirty or so icons used, which would publish Pro artwork. Font Awesome Free only, which lacks the Regular style for most of the icons the look uses. A different open icon set, which would change the approved look.

**What this assumes.** That the Pro licence permits installing with the token in CI and in Cloudflare's build. Ian confirms it with whoever holds the licence before build step 21 installs the packages; until then the fallback is what every environment draws.

**Consequences.** Two looks exist, Pro where the token is and Free where it is not, and the screenshot check compares only the second. A Pro icon that renders wrongly is seen by a person, not by CI.
