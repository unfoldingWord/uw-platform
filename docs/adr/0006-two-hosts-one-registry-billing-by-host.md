---
status: accepted
date: 2026-09-29
---
# Two first-class hosts, one verb registry, an engine seam, and billing by host

A persona runs on either of two hosts with the same verbs and the same gates: a Cloudflare Workflow inside the platform, or a staff member's own Claude Code or Codex on their own machine over remote MCP. Neither is a special mode; a CI test asserts the tool lists are identical. Behind the persona, the model vendor sits behind one seam with six engines, each a directory: `claude-messages`, `claude-code-sandbox`, `claude-managed-agent`, `codex-sandbox`, `external`, `openrouter-messages`. A vendor SDK is imported in exactly one directory and a text gate refuses it elsewhere. Billing is a property of the host, not the persona: a platform-hosted run is metered on the organization's API keys through AI Gateway under one cap set to the Executive Brief's number; an external run is the person's own subscription, with tokens self-reported, labelled as contributed time and never counted against the API budget. Hosted Builder is off by default; the always-on tier (scout passes, Iterate, intake, validators) runs on `openrouter-messages` on a flash-class model.

The reasoning on billing is the vendors' own line: a person's subscription covers that person's use of the vendor's tool, and a product serving other people must use API keys. The harness's hosted personas are the organization's product; a staff member's own tool on their own seat is not.

**Consequences.** No subscription credential is ever stored on the platform. A new engine is a directory, never a branch in another. Cloudflare Sandbox and Containers enter the plan's topology as Builder and Reviewer hosts only, holding no state, with the laptop host as the documented fallback. A Grok or other subscription fits the external host only; an API key for any vendor is one more engine directory. Source: spec Figure 4, "Engines, and who pays", "The always-on tier", D5, D11, D16, D17, D21.
