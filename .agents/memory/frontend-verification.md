---
name: Frontend verification boundaries
description: Avoid false build failures when checking private project-model UI in isolation.
---

Prefer the application's normal module-resolution pipeline for isolated frontend checks. A standalone bundler is not automatically equivalent to the running Vite application.

**Why:** An isolated browser harness initially failed on raw-document imports and case-overlapping component/helper names that the application's normal resolver handles. Those were harness failures, not evidence of a broken application.

**How to apply:** Keep private UI authorization intact. When testing components outside the authenticated page, use canonical fixture builders and clearly distinguish isolated UI verification from verification of the signed-in application.

An isolated PostgreSQL rehearsal does not verify production-only read queries skipped by its test mode.

**Why:** A green rehearsal and full mocked test suite missed a company-page SQL query against nonexistent production columns because that read was disabled for the retained test copy. The page then returned a sanitized 503.

**How to apply:** Audit the skipped production branches against the real schema with read-only queries before claiming readiness. Exercise their SQL contract in regression tests, and do not treat a generic owner-only error footer as evidence of an authentication failure.

Imports into an existing editable document must also pass an ordinary editor save round-trip, not only storage readback or MCP retrieval.

**Why:** A compact imported book could be read correctly while the editor regenerated duplicated Markdown and exceeded its document-size limit on the next small edit. Readability alone did not preserve editability.

**How to apply:** Test a near-limit existing document through the shared editor serializer and save command, retaining every canonical field and history. Compress duplicated presentation, never silently trim source content.

Small display-only fixes may go to the owner for Publish after tests, without Claude review.

**Why:** The owner explicitly changed this rule to shorten minor visual corrections; this does not authorize production/model writes or agent-initiated publishing.

**How to apply:** Keep the exception limited to display-only changes. Future empty teams belong in a separate «Планы» block; the future secretary team must not borrow the living Katya's portrait.
