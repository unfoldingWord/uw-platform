---
status: accepted
date: 2026-11-20
---
# A value is revealed in one uncached answer, and a break-glass reveal needs a second person

ADR 0017 says who may `reveal` a credential and ADR 0018 says one function opens a value. Neither says how the value reaches the person, who hears about it, or how the two-org-admin break-glass reveal of the design works. Issue #159 builds the screen and asks for all three: "Revealing notifies the area's admins. Break-glass reveal needs two org admins."

**Decision (2026-11-20).**

- **One route returns a value.** `POST /api/credentials/reveal` answers `{ status, requestId, value }` with `cache-control: no-store`. `revealCredential` (`apps/uw-app/credentials/reveal.ts`) calls `openCredential`, which asks `can()` for `reveal` and writes the access log before it returns. A build rule lets only `credentials/routes.ts` import `reveal.ts`. The value is in no page, no URL, no event, no log line and no other answer; the browser island puts it in the page as text on an explicit action, and forgets it after one minute, on Hide and when the page is left.
- **A person at the keyboard, checked twice.** Every credential route refuses a principal that is not an interactive person before it reads the body, and `can()` refuses the same principals again.
- **A person who cannot `see` a credential is told it does not exist.** `rotate`, `revoke`, `bind`, `unbind`, giving a reveal grant and `reveal` answer `credential_not_found`, and the reveal-grant commands `grant_not_found`, exactly as for an id that names nothing. The refusal is still written to the access log as `not_permitted`. `use` is unchanged: its caller is platform code.
- **A reveal tells the area's admins by web push.** Every holder of a live `admin` grant on the credential's own area, other than the person revealing, gets a push on each device. The payload names the area and the reason `credential_revealed` and links to `/credentials`; it never names the credential. The notice has no cooldown. A failed or unconfigured push does not hold the value back: the access log row is the record, and the area's admins read it on the credential's page.
- **A break-glass reveal is a reveal grant that waits for a second person.** An admin of the credential's own area gives a reveal grant that is live at once. An org admin who is not one manages the credential only through the org grant, so a grant they give is stored with `second_required` and counts for nothing until a second person who may `manage` the credential confirms it. The database refuses a confirmation by the person who gave it. Both people are on the grant row and each has a row in the access log (`grant_reveal`, `confirm_reveal`). The grant's time starts when it is confirmed, and an unconfirmed one lapses at its original end.
- **A reveal grant lasts between 5 minutes and 24 hours.** The screen offers 15 minutes, 1 hour, 4 hours and 24 hours.

**Rulings this ADR makes,** where the issue and the design left a choice.

- **The second person may be an admin of the area.** The design says two org admins. An area admin could give the same grant alone, so their confirmation is at least as strong, and an area with an admin on hand should not have to find a second org admin.
- **An area admin may give themselves a reveal grant.** The design gives `manage` to an area admin and does not exclude it. The other admins of the area are told at the reveal.
- **The notice is sent at the reveal, not at the grant.** The design's table can be read either way; the issue says revealing notifies.
- **No Zulip post.** A post goes to the area's channel, whose members include people with no `see`.
- **The reveal notice does not go through the kernel's Notifier port.** A `Wake` names a workflow; a credential has none (`docs/exceptions.md`).

**Rejected.**

- **Render the value into the page.** It would sit in the HTML a proxy, a cache, the service worker or the back button could keep.
- **`not_permitted` for a credential the asker cannot see.** It confirms the id exists, which is `see`.
- **A separate break-glass table or command.** The grant row already says who, for whom and until when; two columns say who confirmed it.
- **Block the reveal until every admin's push is delivered.** A person with no device, or a push service that is down, would then lock every value.

**Consequences.**

- An area with one admin has nobody to tell when that admin reveals; the access log is then the only record.
- A value shown in the browser can be copied by the person who sees it; nothing here prevents that.
- `credential_grants` gains `second_required`, `second_by` and `second_at`; the access log's closed set of actions gains `grant_reveal`, `confirm_reveal` and `revoke_reveal`.

Source: issue #159; `prd/Credentials Store - Design Proposal.md`, Part 2; ADR 0016 to ADR 0019.
