# DeepSeek V4 Pro Desktop Implementation Plan

## Goal

Add `deepseek-v4-pro` as an explicitly selectable FD Desktop model while keeping
`deepseek-v4-flash` as the default. Put a compact model selector immediately to the left of the
composer send button. Preserve managed login, exact model authorization, Codex App Server routing,
same-thread model changes, and existing FD Skill permission boundaries.

## Architecture

The existing `fd-deepseek` provider remains the only provider owner. The desktop identity broker
issues one managed runtime token whose exact model limit contains Flash and Pro. The internal
credential projection carries the allowed model list, the server snapshot advertises both models,
and the existing composer draft/thread `ModelSelection` is the only selection state. Ordinary and
FD Skill turns continue through the existing Codex App Server adapter; the selected model is passed
through that adapter per turn. Direct Responses fallback code receives the selected model explicitly.

The DeepSeek API's lack of image/file input support is not addressed in this release. The product
does not add OCR, a local visual model, or a second upstream provider.

## Tech Stack

TypeScript, Effect Schema, React, Base UI Select, Vitest, Codex App Server, OpenAI Responses API,
Electron, pnpm/vite-plus.

## Baseline/Authority Refs

- User requirement in the 2026-08-17 task: model selector left of send; add V4 Pro; do not add an
  unofficial visual parsing pipeline.
- DeepSeek official Responses guide: <https://api-docs.deepseek.com/guides/responses_api>
- DeepSeek official model/pricing page: <https://api-docs.deepseek.com/quick_start/pricing>
- `apps/server/src/fd-agent/FdResponsesProtocol.ts`
- `apps/server/src/fd-codex/FdManagedCodexHome.ts`
- `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts`
- `apps/web/src/composerDraftStore.ts`
- `docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md`

## Compatibility Boundary

- Flash remains the default for existing and new tasks.
- Existing credential projections without an allowed-model list remain Flash-only.
- Only exact `deepseek-v4-flash` and `deepseek-v4-pro` are accepted; aliases and arbitrary models
  remain rejected by Desktop even if Gateway supports them.
- Existing runtime token names, secure storage, login UX, usage reporting, and API-key hiding remain
  unchanged.
- Model changes remain allowed inside the same task because the FD provider already declares
  `requiresNewThreadForModelChange: false` and Codex accepts a model per turn.
- Web/Gateway enterprise Agent endpoints are not migrated or broadened by this change.
- Image/file behavior is unchanged and is not advertised as supported.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Reason: the user requested implementation but did not request strict test-first TDD.
- Verification: focused contract, identity, Responses, provider, model-selection, and UI tests;
  typechecks; production build; live Responses smoke; desktop visual QA.

## Aegis Visibility

Planning is useful because the model allowlist crosses a credential trust boundary, provider
protocol, Codex runtime, persisted thread selection, and release surface.

## BaselineUsageDraft

- Required baseline refs: current FD desktop design, runtime credential contract, official DeepSeek
  Responses/model documentation.
- Delivered context refs: user task history and the current `origin/main` source.
- Acknowledged before plan refs: all required refs above.
- Cited in plan refs: all required refs above.
- Missing refs: none.
- Decision: continue.

## Requirement Ready Check

- Requirement source refs: current user messages and supplied composer screenshot.
- Goals and scope refs: selector placement, Pro support, no unofficial visual parsing.
- User / scenario refs: an authenticated employee chooses Flash or Pro immediately before sending.
- Requirement item refs: exact two-model list, Flash default, same-thread switching, managed token.
- Acceptance / verification criteria refs: official Responses compatibility, focused tests, live smoke,
  and visual placement check.
- Open blocker questions: none.
- Decision: ready.

## Change Necessity

- User-visible need: employees cannot currently select Pro and every Desktop layer rejects it.
- No-change / non-code option: Gateway already supports Pro, but Desktop does not advertise, authorize,
  persist, or route it.
- Why code change is necessary: configuration alone cannot change the strict credential schema,
  runtime token limit, adapter validation, provider snapshot, or composer selection logic.
- Minimum change boundary: existing FD protocol/identity/provider/model-selection owners plus one small
  composer selector component.
- Decision: code-change.

## Existence Check

- Proposed new surface: compact two-model composer selector.
- Existing owner / reuse candidate: Base UI `Select`, composer draft `ModelSelection`, and FD provider
  snapshot.
- Why existing surface is insufficient: the original generic T3 picker was deliberately removed and
  would restore hundreds of lines of multi-provider UI not needed by FD.
- Creation proof: a small view component avoids growing the already large `ChatComposer.tsx` while
  reusing all state and contracts.
- Entropy / retirement impact: remove the component if FD returns to a single model; no parallel state.
- Decision: add-with-proof.

## Architecture Integrity Lens

- Invariant: Gateway and local runtime must both authorize the exact selected model.
- Canonical owner / contract: FD model constants and internal runtime credential projection.
- Responsibility overlap: UI selects; provider validates/routes; Gateway enforces token limits.
- Higher-level simplification: one shared allowed-model constant replaces independent string literals.
- Retirement / falsifier: if Gateway stops exposing Pro or official Responses support regresses, remove
  Pro from the shared list and snapshot.
- Verdict: proceed with the existing owners.

## Complexity Budget

- Artifact class: internal contract plus provider adapter and compact UI component.
- Target files / artifacts: runtime credential contract, FD protocol/client/adapter/driver, Desktop
  identity, model selection, one new composer component, tests, docs.
- Current pressure: `ChatComposer.tsx` and `FdDeepSeekAdapter.ts` are already large.
- Projected post-change pressure: moderate if UI logic is inline; low with a dedicated selector.
- Budget result: within-budget.
- Planned governance: shared helpers for exact model validation; separate view-only selector.

## Plan-Time Complexity Check

- Target files: `FdDeepSeekAdapter.ts`, `FdResponsesClient.ts`, `ChatComposer.tsx`.
- Existing size / shape signals: adapter and composer are large but already own routing and footer
  composition respectively.
- Owner fit: model validation belongs in the adapter; selection presentation belongs in chat UI.
- Add-in-place risk: duplicating model arrays and adding menu markup directly to the composer.
- Better file boundary: shared FD model helpers plus `FdModelSelector.tsx`.
- Recommendation: extract helper/view, keep routing changes in place.

## Files

- Modify `packages/contracts/src/fd/runtimeCredentials.ts` and contract tests.
- Modify `apps/desktop/src/fd-identity/NewApiClient.ts`, `FdIdentityBroker.ts`, and focused tests.
- Modify `apps/server/src/fd-agent/FdResponsesProtocol.ts`, `FdResponsesClient.ts`,
  `FdAgentKernel.ts`, and focused tests.
- Modify `apps/server/src/provider/Layers/FdDeepSeekAdapter.ts` and tests.
- Modify `apps/server/src/provider/Drivers/FdDeepSeekDriver.ts` and tests.
- Modify `apps/server/src/textGeneration/FdDeepSeekTextGeneration.ts` and tests.
- Modify `apps/web/src/modelSelection.ts`, `providerInstances.ts`, and tests.
- Create `apps/web/src/components/chat/FdModelSelector.tsx` and its focused test.
- Modify `apps/web/src/components/chat/ChatComposer.tsx` only to wire the selector beside send.
- Update user/release documentation.

## Tasks

### Task 1: Establish the exact two-model contract

Files: FD protocol constants, runtime credential schema, Desktop runtime token creation, identity
projection, and focused tests.

Why: Pro cannot be used safely until local and Gateway authorization agree on the exact allowlist.

Change Necessity: source edits are required because the current schema and token assertion accept one
literal only.

Impact/Compatibility: retain `policy.model` as the Flash default and add an optional exact `models`
tuple so old projections remain Flash-only.

Verification:

```sh
vp test run packages/contracts/src/fd/contracts.test.ts \
  apps/desktop/src/fd-identity/NewApiClient.test.ts \
  apps/desktop/src/fd-identity/FdIdentityBroker.test.ts
```

Steps: add shared exact model literals and guards; provision/assert the comma-separated two-model
runtime limit; publish both allowed models; add regressions for old Flash-only and new dual-model
projections; commit.

### Task 2: Route the selected model through Responses and Codex

Files: Responses request/client/kernel, FD adapter/driver, text-generation gate, managed Codex tests,
and focused tests.

Why: advertising Pro without passing it to the actual Responses request would be a lying control.

Change Necessity: current adapter validation, events, SDK model, exact fetch body, and metadata checks
all force Flash.

Impact/Compatibility: Flash remains the default; Pro is accepted only when the credential projection
contains it; helper text generation continues on Flash; enterprise authorization and tool execution
are unchanged.

Verification:

```sh
vp test run apps/server/src/fd-agent/FdResponsesClient.test.ts \
  apps/server/src/fd-agent/FdAgentKernel.test.ts \
  apps/server/src/provider/Layers/FdDeepSeekAdapter.test.ts \
  apps/server/src/provider/Drivers/FdDeepSeekDriver.test.ts \
  apps/server/src/textGeneration/FdDeepSeekTextGeneration.test.ts \
  apps/server/src/fd-codex/FdManagedCodexHome.test.ts
```

Steps: put the selected model on direct-kernel requests and active turns; validate against the exact
allowlist; send/check the selected model in Responses; advertise both models; preserve per-turn model
selection when forwarding to Codex; add Flash/Pro/rejection regressions; commit.

### Task 3: Add the compact composer selector

Files: model selection helper/tests, provider constants, new `FdModelSelector.tsx` and test,
`ChatComposer.tsx` wiring.

Why: employees need a visible, immediate model choice at the requested location.

Change Necessity: current app model resolution ignores every requested model and forces Flash; the
composer renders no model control.

Impact/Compatibility: selector uses the live provider snapshot, writes the existing composer draft
selection, displays `V4 Flash`/`V4 Pro`, and is disabled only when the provider/control is unavailable.

Verification:

```sh
vp test run apps/web/src/modelSelection.test.ts \
  apps/web/src/components/chat/FdModelSelector.test.tsx \
  apps/web/src/components/ChatView.logic.test.ts
```

Steps: preserve an allowed requested model; create the compact Select; wire it immediately before the
primary send actions; confirm the selected model enters `getSendContext`; commit.

### Task 4: Verify, document, and release

Files: user docs, release notes, package version only as required by the release workflow.

Why: model cost/capability differences and the no-vision boundary must be explicit and the shipped
assets must match source.

Change Necessity: documentation and release metadata must describe the user-visible change.

Impact/Compatibility: release only macOS arm64 and Windows x64; keep internal unsigned policy and
existing updater behavior.

Verification:

```sh
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/desktop typecheck
vp run --filter @t3tools/server typecheck
vp run --filter @t3tools/web typecheck
vp run build
git diff --check
```

Then run one authenticated `deepseek-v4-flash` and one `deepseek-v4-pro` `/v1/responses` smoke with
text and a function tool, visually inspect the selector in the desktop app, run pre-landing review,
push/merge, build the next version after `0.2.8`, publish atomically, and verify public manifests.

## Plan Pressure Test

- Owner / contract / retirement: existing owners reused; one removable view component added.
- Architecture integrity / higher-level path: shared exact model helpers prevent string drift.
- Verification scope: contract, identity, direct Responses, Codex forwarding, UI, build, live API,
  release manifests.
- Task executability: exact files, boundaries, and commands are identified.
- Pressure result: proceed.

## Execution Readiness View

- Intent Lock: Flash default, Pro selectable left of send, no visual parsing pipeline.
- Scope Fence: Desktop FD provider only; no Gateway enterprise Agent migration or image feature.
- Baseline Lock: `origin/main` at `6dfad9f8`, official DeepSeek 2026 docs, existing FD design.
- Approved Behavior: exact two-model selection with managed credentials and same-thread switching.
- Owner / Contract Constraints: credential projection and token limits remain fail-closed.
- Compatibility Boundary: old projections Flash-only; current default unchanged.
- Retirement Boundary: no legacy picker restoration; remove compact selector if only one model remains.
- Task Batches: contract/auth; runtime routing; UI; verification/release.
- Test Obligations: focused tests, four typechecks, production build, live Responses, visual QA.
- Review Gates: diff review before commit and public manifest verification after publish.
- Drift / Rewind Rules: stop if production Gateway cannot serve Pro Responses or Codex rejects
  same-thread switching; do not fall back silently to Flash.
- Evidence Required Before Completion: selected model in request/event, successful live response,
  screenshot/interaction proof, CI assets, public manifests.
- Advisory Boundary: method-pack execution guidance only; not completion authority.

## Risks

- Pro costs roughly three times Flash and has lower official concurrency; keeping Flash default limits
  accidental cost/throughput impact.
- Persisted tasks created by older versions may carry Flash; explicit user selection must override it.
- The official API silently ignores unsupported image input, so no image capability claim is made.
- A channel may list Pro but still be misconfigured; live smoke is a release stop gate.

## Retirement

No old runtime owner or compatibility adapter is retained. Independent Flash string literals are
collapsed into the shared FD model contract. The removed generic T3 model picker remains removed.
