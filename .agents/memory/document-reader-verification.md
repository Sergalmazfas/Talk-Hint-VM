---
name: Document reader verification
description: A saved organizational document must remain readable by the actual book and MCP readers, not just the database.
---

When updating the existing organization book, verify the actual document reader
against the saved representation. A successful database write and a plausible
title/version are not proof that the web book can parse the same content.
Keep the human-facing and machine-readable representations consistent.

**Why:** adding a case note outside a structured document temporarily made the
book unreadable even though its document identity and database history were intact.

**How to apply:** serialize through the existing document formatter, check the
corresponding reader and version before committing, preserve prior revisions,
and verify a supported authenticated document link. Do not invent new query
parameters as if they were working deep links.

Validate a crew extension against the real domain rules, not only a pure helper
and TypeScript types. Those checks are not equivalent.

**Why:** a description-only extension passed its helper checks but was rejected
by the actual organizational model before commit. The transaction correctly
preserved the earlier state.

**How to apply:** include the actual domain validator in the final verification,
respect dependencies between newly registered documents and their references,
and commit the coherent change atomically. Never relax the validator to force an import.

Keep a full improvement journal's cases and history in the canonical document.
If reference material must move to fit the document limit, preserve it verbatim
in a linked appendix of the same model, with its source revision. This is a
continuation of the journal, not a second operational source.

**Why:** the owner requires stable identities and complete history; silently
truncating a full journal or creating an independent duplicate would break that.

**How to apply:** budget serialized size before writing, distinguish cases from
reference material, and verify both the root and linked appendix through the
normal reader. Do not expand a general storage limit merely to fit one entry.

Crew prompt proposals should store common instructions, schemas and dated lessons
once in the canonical model, with role-specific text and references. A downloadable
review snapshot may expand those references, but expansion must be byte-equivalent
to the recorded blocks and carry source revision/hash evidence.

**Why:** duplicating the common backstory, lesson block and unchanged action
records across two proposals exceeded the hypothesis's active-data budget; this
was not a compute shortage or permission to remove earlier work.

**How to apply:** preflight the actual domain size guard, keep stable action
references instead of another action catalogue, and verify both stored document
reads and the fully expanded review export. Do not change active passport links
or runtime prompts just to register a proposal.
