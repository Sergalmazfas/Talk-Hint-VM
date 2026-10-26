---
name: Frontend verification boundaries
description: Avoid false build failures when checking private project-model UI in isolation.
---

Prefer the application's normal module-resolution pipeline for isolated frontend checks. A standalone bundler is not automatically equivalent to the running Vite application.

**Why:** An isolated browser harness initially failed on raw-document imports and case-overlapping component/helper names that the application's normal resolver handles. Those were harness failures, not evidence of a broken application.

**How to apply:** Keep private UI authorization intact. When testing components outside the authenticated page, use canonical fixture builders and clearly distinguish isolated UI verification from verification of the signed-in application.

Imports into an existing editable document must also pass an ordinary editor save round-trip, not only storage readback or MCP retrieval.

**Why:** A compact imported book could be read correctly while the editor regenerated duplicated Markdown and exceeded its document-size limit on the next small edit. Readability alone did not preserve editability.

**How to apply:** Test a near-limit existing document through the shared editor serializer and save command, retaining every canonical field and history. Compress duplicated presentation, never silently trim source content.
