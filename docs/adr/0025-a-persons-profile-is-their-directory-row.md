---
status: accepted
date: 2026-11-21
---
# A person's profile is their directory row

Ruled by an owner on 2026-11-21 as decision H of `prd/Databases and Views - Design Proposal.md`.

**Decision.** There is one page per person: the row of the directory collection for their `people` record. It is the profile the app opens wherever a person appears (a person property, an assignee, a page owner, a comment author, an approver on a gate, a mention), so every person chip links to it. Nothing about a person is kept on a second profile screen.

- **What it shows.** The directory properties the reader may read (ADR 0024), the narrative body, and read-through lists of their open tasks, the programs and projects they lead or work on, and the pages they own.
- **Who edits what.** A person edits their own contact fields and body. Role, team, employment and compliance fields are written by the people who administer the directory: `admin` on `10-19`, or an org admin. Both go through the people module, which owns `people` and `directory_entries`.
- **Where it lives.** The directory fields are columns of `directory_entries` (one row per person, owned by the people module), not page frontmatter, because they are a typed record (decision F of ADR 0023). The narrative body is a page the row points at, created the first time it is written.

**Built where.** #206 builds the directory collection, its properties and their rules, and the row page at `/collections/directory/rows/:personId`. #208 builds the person chip in `packages/ui`, uses it everywhere a person is shown, and adds the read-through lists.

**Rejected.** A profile screen separate from the directory (two places to keep a person's details); profile fields in `people` (it is the sign-in record, read at the edge on every request).
