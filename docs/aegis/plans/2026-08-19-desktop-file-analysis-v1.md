# Desktop One-Off File Analysis V1 Implementation Plan

## Goal

Implement the approved Design Spec
`FD-gateway/docs/aegis/specs/2026-08-19-desktop-file-analysis-v1-design.md`
in the Desktop repository. Employees should be able to attach common image,
PDF, Office, and text files for one-turn analysis. The feature is Desktop-only,
local-first, bounded, cancellable, and must not introduce knowledge-base or
enterprise-file behavior.

## Baseline and Authority

- Desktop design spec: `FD-gateway/docs/aegis/specs/2026-08-19-desktop-file-analysis-v1-design.md`
- Current Desktop image path: `apps/web/src/components/chat/ChatComposer.tsx`,
  `apps/web/src/components/ChatView.tsx`, `apps/server/src/attachmentStore.ts`
- Current attachment contract: `packages/contracts/src/orchestration.ts`
- Current FD image adapter: `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts`
- Current FD enterprise boundary: `apps/server/src/provider/Layers/FdDeepSeekAdapter.ts`
- Existing Web parser reference (read-only for this work):
  `FD-gateway/apps/fd-workspace/src/lib/workspace-attachments.ts`
- Existing server-owned enterprise runtime: `FD-gateway/docs/aegis/adr/ADR-0005-server-owned-enterprise-fd-skill-runtime.md`

## Scope Check

### Facts

- The Desktop UI currently accepts only images and persists them as server-owned
  attachment files before sending a turn.
- The local Server is a separate process from the Electron renderer and is the
  correct owner for file persistence, parsing, limits, and provider input.
- `ChatComposer` is shared by Web and Desktop, so UI gating is required.
- FD-managed Skill turns currently reject all attachments and must remain
  fail-closed.

### Assumptions to verify during execution

- `officeparser` can parse our Chinese PPTX fixtures without unacceptable
  memory growth or bundle failures.
- A normalized document context can fit within the existing FD request-size
  ceiling with conservative limits.
- The existing persistence projection can retain document metadata without a
  migration because `ChatAttachment` is already serialized as JSON.

### Unknowns

- Whether the current packaged Server bundle resolves `officeparser` assets in
  both macOS arm64 and Windows x64 builds.
- Whether OCR language data can be packaged without making the installer or
  startup path unacceptable.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable; the user requested real testing but did
  not request strict test-first TDD.
- Test posture: diagnostic qualification fixtures plus focused post-change
  regression and live API acceptance.
- Reason: parser compatibility and packaging need exploratory tests before the
  final implementation shape is locked.
- Verification: parser unit tests, orchestration/adapter tests, real fixture
  smoke, local authenticated API turn, Desktop build/smoke, and no Web UI
  regression.

## Requirement Ready Check

- Requirement source refs: approved Desktop Design Spec and the current user
  request to implement and test with real files/API.
- Goals and scope refs: Desktop-only one-off analysis, common file coverage,
  no knowledge base, no Web behavior change.
- User/scenario refs: employee uploads PDF/PPT/image/Office file and asks a
  single analysis question.
- Acceptance refs: Design Spec verification matrix plus live API evidence.
- Open blocker questions: none for implementation; `officeparser` and OCR
  packaging are execution qualification gates.
- Decision: ready.

## Change Necessity

- User-visible need: the Desktop Composer cannot select documents and the
  server contract rejects everything except images.
- No-change option: documentation or provider configuration cannot add safe
  file selection, parsing, persistence, or normalized model context.
- Minimum code boundary: existing contracts, Desktop-shared Composer/ChatView
  attachment flow, server attachment persistence, a server-side parser owner,
  and provider normalization.
- Decision: code-change.

## Existence Check

- Proposed new surface: `DocumentContext` parser and a server-side one-off
  document analysis owner.
- Existing owner/reuse candidate: image `attachmentStore` and provider
  attachment resolution.
- Why insufficient: image-only schemas, extension paths, and input adapters
  cannot represent extracted sections, OCR warnings, or document limits.
- Creation proof: one parser owner prevents PDF/PPTX logic from being copied
  into each provider adapter; it is reusable for future enterprise policy
  without becoming a knowledge-base owner.
- Entropy/retirement: provider-specific document parsing is forbidden; if a
  future File Gateway becomes authoritative, the local parser remains only
  for personal files and the migration trigger is recorded in the next ADR.
- Decision: add-with-proof.

## Architecture Integrity Lens

- Invariant: the renderer selects files; the local Server validates, stores,
  parses, bounds, and normalizes; providers consume normalized content.
- Canonical contract: `ChatAttachment` plus `DocumentContext` in contracts;
  raw data URLs exist only on the upload command boundary.
- Responsibility overlap: no parser code in Composer, Codex adapter, FD
  provider driver, or EnterpriseAgentRuntime.
- Higher-level simplification: the same normalized document context feeds
  ordinary Codex and FD ordinary chat without provider-specific file protocols.
- Retirement/falsifier: if parser quality or package size fails the real-file
  gate, disable the document flag and retain image-only behavior; do not add a
  second hidden fallback.
- Verdict: proceed with a server-owned local parser and explicit Desktop UI
  gating.

## Plan-Time Complexity Check

- Artifact class: shared contract plus server parser and shared Composer flow.
- Pressure: `ChatComposer.tsx`, `ChatView.tsx`, and FD adapters are already
  large; attachment store paths are image-specific.
- Better boundary: add `apps/server/src/fileAnalysis/` for parsing/normalizing,
  a small shared document attachment helper in `apps/web/src/`, and keep
  `ChatView` changes to send-context wiring.
- Budget result: at risk if parsing is added inline; within budget with a
  dedicated parser module and focused UI helper.
- Recommendation: add owner files, keep existing owners as thin wiring.

## File Map

### Contracts

- Modify `packages/contracts/src/orchestration.ts` to add bounded document
  attachment and upload variants, document limits, and `DocumentContext` types.
- Modify `packages/contracts/src/orchestration.test.ts` for valid/invalid
  document contracts and limits.

### Server file analysis

- Create `apps/server/src/fileAnalysis/DocumentContext.ts` for normalized
  sections, warnings, truncation, and formatting into a bounded prompt block.
- Create `apps/server/src/fileAnalysis/DocumentParser.ts` for MIME validation,
  parser selection, PDF/DOCX/XLSX/text parsing, and qualified PPTX parsing.
- Create `apps/server/src/fileAnalysis/DocumentParser.test.ts` with fixture and
  failure tests.
- Modify `apps/server/src/attachmentPaths.ts` and
  `apps/server/src/attachmentStore.ts` for safe document extensions.
- Modify `apps/server/src/orchestration/Normalizer.ts` to validate and persist
  document uploads by magic type and produce metadata-only attachments.
- Modify `apps/server/src/orchestration/Normalizer.test.ts` and
  `apps/server/src/attachmentStore.test.ts` for document persistence and path
  safety.

### Provider input

- Modify `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts` to resolve
  document contexts through the parser owner and reject enterprise Skill
  attachments explicitly.
- Modify `apps/server/src/provider/Layers/CodexAdapter.ts` or its existing
  message normalization boundary only if ordinary Codex needs the same
  formatted document context; do not add a second parser.
- Add focused driver/adapter tests for ordinary document turns, truncation,
  parse failure, and FD Skill rejection.

### Desktop-only shared UI

- Modify `apps/web/src/types.ts` and `apps/web/src/composerDraftStore.ts` for
  document draft state without changing the Web default behavior.
- Create `apps/web/src/lib/documentAttachments.ts` for file validation,
  preview metadata, upload serialization, and localized status labels.
- Modify `apps/web/src/components/chat/ChatComposer.tsx` to accept image/file
  attachments only when `isElectron` is true; keep Web `image/*` behavior
  unchanged.
- Modify `apps/web/src/components/ChatView.tsx` to serialize document uploads,
  include metadata in optimistic messages, and preserve retry behavior.
- Add focused UI tests for Desktop-only picker gating, drag/drop, status, limits,
  and retry.

### Dependencies and fixtures

- Modify `apps/server/package.json` and the lockfile to add the qualified
  `officeparser` version and any explicitly approved MIME helper.
- Create small real fixtures under
  `apps/server/src/fileAnalysis/fixtures/`: text PDF, Chinese PPTX with notes
  and table, DOCX with headings/table, XLSX with multiple sheets, PNG, scanned
  image/PDF sample, corrupted and password-protected samples.
- Keep fixtures small, synthetic, and free of enterprise data.

### Documentation

- Update the Desktop file-input/release documentation after implementation,
  including supported formats, limits, OCR behavior, and live API evidence.
- Do not change Web feature documentation to claim Desktop-only document
  support.

## Execution Tasks

### Task 1: Qualify parser dependencies and real fixtures

1. Add a small synthetic fixture set using real file formats, not text files
   renamed with Office extensions.
2. Add `officeparser` in a temporary qualification branch of the server
   dependency graph.
3. Run direct parser probes against Chinese PPTX, notes, tables, chart data,
   DOCX, XLSX, text PDF, and scanned PDF.
4. Record parse output, latency, peak memory, OCR behavior, and any warnings.
5. Stop and revise the plan if PPTX compatibility or package resolution fails;
   do not silently switch to a different parser.

Expected evidence: a repeatable command and fixture report with parser version,
file hashes, output summary, elapsed time, and memory peak.

### Task 2: Extend contracts and safe attachment storage

1. Add `ChatDocumentAttachment` and `UploadChatDocumentAttachment` with strict
   filename, MIME, size, and extension bounds.
2. Add normalized `DocumentContext`/section/warning schemas without raw bytes,
   local paths, or arbitrary provider fields.
3. Extend safe path resolution for approved Office/PDF/text extensions.
4. Add contract/path tests, including mismatched MIME and traversal attempts.
5. Run contracts and attachment-store focused tests before wiring providers.

### Task 3: Implement the server parser owner

1. Implement parser dispatch and magic-byte checks in `DocumentParser.ts`.
2. Reuse existing `pdfjs-dist`, `mammoth`, `xlsx`, and native text logic where
   proven; use qualified `officeparser` for PPTX/complex Office.
3. Keep OCR bounded, cancellable, and explicitly marked in warnings.
4. Format sections into one bounded prompt context with page/slide/sheet
   locations and truncation markers.
5. Integrate document upload persistence into `Normalizer.ts` without changing
   existing image persistence.
6. Add parser, cancellation, limits, and normalizer tests.

### Task 4: Route normalized documents through ordinary turns

1. Resolve document metadata through the server parser owner before the model
   request.
2. Append the bounded `DocumentContext` block to ordinary Codex/FD text input.
3. Preserve direct image parts for image attachments.
4. Reject any document/image attachment on an FD-managed Skill turn with a
   Chinese user-facing validation error; never pass it to the enterprise
   runtime.
5. Ensure title generation uses filename summaries only and does not retain raw
   extracted content as extra history.
6. Add driver, adapter, and title-context regressions.

### Task 5: Add Desktop-only attachment UI

1. Add a file picker/drag-drop branch guarded by `isElectron`.
2. Preserve the current image compression and preview path.
3. Add document cards with parse/upload status and localized errors.
4. Serialize document files only at send time and clear temporary draft bytes
   after successful dispatch or removal.
5. Keep Web’s current image-only picker and behavior unchanged.
6. Add UI tests for Desktop/Web gating, multiple files, parse/send disablement,
   removal, retry, and FD Skill rejection.

### Task 6: Real-file, real-API, and packaged Desktop verification

1. Run all parser fixtures through the local bundled Server.
2. Start the local Desktop backend with the existing managed test account;
   never print or commit credentials.
3. Execute authenticated ordinary turns for:
   - text PDF summary;
   - Chinese PPTX risk summary;
   - DOCX extraction;
   - XLSX aggregation;
   - image description.
4. Capture request/response metadata, selected provider/model, parse warnings,
   token usage, latency, and final answer quality. Redact file contents and
   tokens from logs.
5. Execute a negative FD Skill attachment turn and confirm fail-closed behavior.
6. Run Desktop macOS UI acceptance with real files, including drag/drop and
   cancellation.
7. Run Desktop Windows x64 package/build smoke; do not claim physical Windows
   UI acceptance without a real Windows machine.
8. Run changed-package tests, typechecks, production build, and `git diff --check`.

### Task 7: Documentation and release gate

1. Record supported formats, limits, known boundaries, and the real-file/API
   evidence in the Desktop release documentation.
2. Run a pre-landing review for contract, data retention, and enterprise Skill
   boundaries.
3. Build only after all parser and API gates pass. Do not deploy or publish a
   new Desktop artifact from a failed qualification run.

## Compatibility Boundary

- No document picker or document claim appears in Web.
- Existing image-only contracts, histories, retries, and provider adapters
  remain valid.
- Ordinary local files may be analyzed through the local Desktop backend; raw
  file bytes are not stored in conversation history.
- FD-managed Skills continue to use the server-owned runtime and reject local
  attachments until a signed Skill file policy exists.
- No automatic model switching, Pro capability change, or updater change is in
  scope.

## Risks and Stop Conditions

- Stop if `officeparser` fails the Chinese PPTX fixture or creates unsafe memory
  growth; keep the feature flag disabled until a documented alternative is
  approved.
- Stop if packaged macOS/Windows bundles cannot resolve parser assets.
- Stop if OCR causes UI/backend hangs or exceeds the agreed memory budget.
- Stop if the API request exceeds the FD request-size ceiling; lower context
  limits rather than adding a Base64 file protocol.
- Stop if any document content or local path appears in persisted history or
  enterprise audit unexpectedly.

## Retirement

- Do not add provider-specific document parsers.
- Remove any temporary qualification shim after the production parser owner is
  selected.
- If a future FD File Gateway becomes authoritative for enterprise files,
  retain this path only for personal local files and route enterprise files via
  the approved server policy.

## Execution Readiness View

- Intent Lock: Desktop one-off file analysis with real-file/API acceptance.
- Scope Fence: Desktop renderer/shared Composer, embedded local Server parser,
  contracts, provider normalization; no Web UI or enterprise runtime change.
- Baseline Lock: approved Design Spec, current image path, current FD Skill
  rejection, and current attachment persistence.
- Approved Behavior: images, PDF, DOCX, XLSX, PPTX, text files; bounded context;
  explicit errors; no knowledge base.
- Owner/Contract Constraints: Server owns parsing/storage; providers consume
  `DocumentContext`; raw data URLs stay at upload boundary.
- Compatibility Boundary: Web image-only behavior and enterprise Skill
  fail-closed behavior remain unchanged.
- Retirement Boundary: no duplicate parser owners; future File Gateway only
  takes enterprise files after an approved migration.
- Task Batches: qualification; contract/storage; parser; provider; UI; real
  acceptance; docs/release.
- Test Obligations: synthetic real fixtures, focused tests, live API turns,
  macOS UI, Windows build smoke, request-size and persistence checks.
- Review Gates: officeparser qualification before dependency lock; API evidence
  before packaging; pre-landing review before merge.
- Evidence Required: parser report, test output, redacted API transcript,
  Desktop screenshots/interaction notes, package smoke output.
- Advisory Boundary: method-pack execution guidance only; not completion
  authority.
