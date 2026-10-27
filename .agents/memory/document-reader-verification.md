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
