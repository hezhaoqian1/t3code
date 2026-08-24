# Desktop Vision Routing Implementation Plan

## Goal

Allow ordinary Desktop tasks to analyze dragged or pasted images reliably while
keeping the existing Codex App Server session on the selected Flash/Pro model.
Images are preprocessed by the FD Vision model, and a bounded, clearly marked
result is added to the current Agent turn. FD-managed enterprise Skills remain
fail-closed for local image attachments.

## Baseline and decisions

- The Desktop composer already accepts image drag/drop, paste, compression, and
  preview in `apps/web/src/components/chat/ChatComposer.tsx`.
- `DocumentParser` already owns text extraction for PDF/PPTX/DOCX/XLSX and will
  remain the document owner; Vision complements it for images and visual pages.
- The local Desktop Server already owns attachment resolution and the FD
  Responses client. No renderer-side API key or direct DeepSeek call is added.
- The selected Flash/Pro model remains the Codex Agent model. Vision is hidden
  from the user model picker and is called only when an ordinary turn contains
  images.
- Enterprise Skill turns continue rejecting local attachments until a
  server-owned enterprise Vision Worker exists.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable; strict test-first was not requested.
- Test posture: focused post-change regression, mocked Vision transport, real
  image fixture smoke, then packaged Desktop verification.

## Requirement Ready Check

- Requirement source: approved automatic-routing design and the user's request
  to continue with direct image drag/drop.
- Acceptance: image drag/paste, image-only and text+image turns, Flash/Pro both
  work without runtime-switch errors, enterprise Skill rejection remains clear,
  and failures are actionable in Chinese.
- Open blockers: exact production model entitlement must be confirmed by the
  runtime policy after the contract change.
- Decision: ready.

## Change necessity

- A protocol-only attachment path is insufficient because current Flash/Pro
  turns do not provide reliable visual understanding.
- Minimum code boundary: runtime model policy, a server-side Vision owner,
  ordinary-turn routing/injection, UI status/error projection, and tests.
- Decision: code-change.

## Architecture and ownership

- Renderer: selects files, previews them, and reports bounded attachment state.
- Attachment store/parser: validates and reads local files; existing document
  parsing remains unchanged.
- Vision owner: new `apps/server/src/fd-vision/` service calls the existing
  `FdResponsesClient` with the Vision model and returns bounded structured text.
- FD adapter: invokes Vision before ordinary Codex execution and injects the
  result as untrusted attachment evidence; it never changes the session model.
- Enterprise boundary: `fdSkillVersionId !== undefined` rejects local images.

## File map

- `packages/contracts/src/fd/runtimeCredentials.ts`: add the Vision model and
  separate selectable models from authorized runtime models.
- `packages/contracts/src/fd/contracts.test.ts` and runtime credential tests:
  cover policy decoding and authorized model limits.
- `apps/server/src/fd-agent/FdResponsesProtocol.ts`: expose Vision model and
  bounded vision request limits without making it a picker model. Legacy
  two-model credential policies remain decodable.
- `apps/server/src/fd-vision/FdVisionService.ts`: create the single Vision
  owner, structured result schema, prompt-injection-safe context formatting,
  timeout, cancellation, and output limits.
- `apps/server/src/fd-vision/FdVisionService.test.ts`: mocked Responses tests,
  malformed output, size limits, timeout, and cancellation.
- `apps/server/src/provider/Layers/FdDeepSeekAdapter.ts`: run Vision only for
  ordinary image turns, inject its bounded evidence into the current user
  message, and preserve enterprise rejection.
- `apps/server/src/provider/Layers/FdDeepSeekAdapter.test.ts`: image-only,
  mixed text/image, Flash/Pro, failure, and no-runtime-switch coverage.
- `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts`: expose only Flash/Pro
  in the provider snapshot and declare image support through the routed path.
- `apps/web/src/components/chat/ChatComposer.tsx` and related timeline/state
  files: preserve existing drag/drop and paste behavior, add Chinese analysis
  status/error projection only where the current event model supports it.
- `apps/web/src/components/chat/FdModelSelector.tsx` tests: assert Vision is
  not displayed as a selectable model.
- `docs/user/file-analysis.md` and release documentation: document direct image
  analysis, limits, enterprise Skill boundary, and drag/drop behavior.

## Compatibility

- Existing text-only turns must generate identical provider requests.
- Existing document parsing remains local and unchanged.
- Existing image attachments remain bounded by current MIME/size/count limits.
- No API key is added to the renderer or package resources.
- No Web-only behavior is expanded; shared Composer changes must remain
  Desktop-gated for documents.

## Verification

- Contract and service unit tests.
- Adapter regression tests for text-only, image-only, mixed, and Skill paths.
- Real fixtures: screenshot OCR, table screenshot, chart, low-resolution image,
  and multiple images.
- Live authenticated API smoke using a temporary credential that is not stored.
- Desktop typecheck/build and macOS packaged smoke; Windows verification uses
  the existing CI/package smoke if a Windows host is unavailable.
- Confirm no raw image bytes are added to persisted chat history beyond the
  existing temporary attachment lifecycle.
- Server typecheck and focused adapter/service/contract tests are required before
  packaging. Live API smoke remains a release gate only when a temporary
  authorized credential and an entitled Vision model are available.

## Risks and retirement

- Vision latency/cost: use one bounded request per turn, strict timeout, and no
  unbounded retry; disable the route behind a policy flag if live quality fails.
- Model entitlement mismatch: fail with an explicit unavailable-vision message,
  never silently fall back to a text-only answer.
- Prompt injection in images: label output as untrusted evidence and never let
  it change tool permissions or Skill policy.
- If a future server-owned Enterprise Vision Worker becomes authoritative,
  retire the local enterprise rejection only after that worker passes the same
  audit and redaction acceptance tests.
