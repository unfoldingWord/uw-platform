---
status: accepted
date: 2026-11-23
---
# An entity's place in the cascade is a placement row, and the JD map is a table an org admin writes

The platform organizes everything twice: by Johnny.Decimal area (where a thing is filed) and by the Strategic Cascade (why it exists). Plan section 15 asks that every entity carry both coordinates, that neither be derived from the other, and that the relation between areas and cascade nodes be explicit. Issue #202.

**Decision.**

1. **A cascade node is a page.** A page of type `portfolio`, `program` or `project` is a node, at the tier its type names. The built-in collections already keep them; nothing new stores a node.
2. **An entity's place in the cascade is one row of `cascade_placements`**, keyed by the entity's kind (`page`, `task` or `item`) and id, naming one node. The entity's area stays on the entity. A node is never placed: it sits at its own tier. Placing needs write on the entity's area and read on the node's.
3. **The JD map is `jd_cascade_map`:** one row per area, node and relation (`owns`, `supports`, `funds`, `reports_on`), many to many. Only an org admin declares or removes a row, and each change writes `jd_cascade_map_audit` with the row before and after.
4. **The crosswalk reads both** and counts only areas the reader can read (ADR 0015).
5. **The crosswalk module owns the three tables.** No other module writes them, and the crosswalk module writes no entity's own table.

**Rejected.**

- **A `cascade_page_id` column on `pages`, `tasks` and `harness_items`.** Each table has one owner (AGENTS.md rule 3), so the column would be written by three modules, and `harness_items` is a kernel table reached through the Store port. One placement table gives one writer and adds nothing to the kernel. The cost: the database cannot hold a foreign key from `entity_id` to three tables, so a placement can outlive a deleted task. Pages are retired, never deleted, and items are not deleted, so only a task can leave one behind; the crosswalk joins through the entity, so such a row counts nothing.
- **Deriving the cascade from the area, or the area from the cascade.** The plan's point is that they are different facts; a project filed in Finance can serve a field program.
- **A portfolio or program select on each collection.** That is the duplicated-select debt the plan names. A test refuses a select property named for a tier on any built-in collection.
- **Letting an area admin declare the map.** The map relates an area to the whole organization's strategy, so it is an org decision.

**Consequences.** Placing work is a separate step from filing it, and the crosswalk's "Not placed" column is the list still to do. A node retired later stops counting its placements without losing them, so reviving it restores them.
