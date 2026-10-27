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
