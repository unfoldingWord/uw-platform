---
status: accepted
date: 2026-11-20
---
# Knowledge pages are filed in a category, and everyone reads 00-09

The Notion wiki it replaces is organised by Johnny.Decimal numbers: an article is `01.47 Security Guidelines`, in category `01`, in area `00-09`. The platform already scopes grants by area. This ADR records how a wiki page is filed and who can read the shared area. The owner decided each point on 2026-11-20 (issue #175).

**Decision.**

1. **A knowledge page is filed in a category.** A page of type `knowledge` carries a required two-digit `jd_category`. Its area is that category's decade, so `61` is in `60-69` and `74` in `70-79`. The pages module refuses a create or save whose category and area disagree. A page may also carry a JD ID such as `61.03`, which must begin with its category.
2. **An area is always one decade.** `60-79 Field Programs` is a **cluster**: a label over `60-69` and `70-79` in navigation. A cluster holds no pages and takes no grant. A page is always in one decade, never in the cluster. Grants stay per decade, as ADR 0015 set them.
3. **Everyone approved reads `00-09`.** Approving a person gives them `viewer` on `00-09`, recorded in `grant_audit` with the action `default`, and existing people were given it by the migration. `00-09` is the organization's home: policies, handbooks, how we work. Other areas still need their own grant.
4. **Moving a page to another area needs the editor role in both.** `move_page` changes the category, and with it the area. The page keeps its id, so links to it keep working. Its JD ID is cleared, because the old number names the old category.
5. **A category's name is data.** `jd_categories` holds the name shown beside a number. An area admin names a category; a category with no name shows its number.

**Rejected.**

- **Folders or free nesting in place of categories.** People already cite pages by number. A tree with no numbers would lose the address every existing page has.
- **A grant on the cluster.** It would read two areas with one grant, which ADR 0015 just removed for a reason: a grant reads one area.
- **Everyone reads everything.** Finance and the credentials store are next to arrive. Open reading is a visible `org` grant, not the default.
- **Category as a tag.** A tag does not decide who can read a page. Filing has to, so it is checked against the area on every write.

**Consequences.** A page cannot be created without choosing a category, so the migration of Notion content (#176) must derive one for every page or list the page for a person to file. Search, the Quick Switcher, backlinks and embeds all show a person only pages in areas they can read, so two people can see different results for the same words.

Source: issue #175; `prd/Knowledge Base - Design Proposal.md`; ADR 0015.
