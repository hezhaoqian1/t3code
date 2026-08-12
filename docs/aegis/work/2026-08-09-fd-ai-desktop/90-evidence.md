# FD AI Desktop implementation - Evidence

Evidence is recorded below.

## EvidenceBundleDraft

- Artifact key: task-1-baseline-tests
- Type: test
- Source: vp test: DesktopLocalEnvironmentAuth, http, EnvironmentAuth, providerStatusCache
- Summary: 4 test files and 17 tests passed on unmodified runtime source with Node 24.14.0 and frozen lockfile.
- Verifier: Vitest 4.1.9 exit code 0

## EvidenceBundleDraft

- Artifact key: task-2-workspace-graph
- Type: inspection
- Source: pnpm -r list --depth -1 and retired-reference rg
- Summary: Workspace graph loads with 11 projects; active build/release metadata contains no mobile, marketing, relay, SSH, or Tailscale workspace references.
- Verifier: pnpm exit 0; rg returned no active matches

## EvidenceBundleDraft

- Artifact key: task-2-script-regression
- Type: test
- Source: vp test and @t3tools/scripts typecheck
- Summary: Four focused script test files passed 108 tests; scripts package typecheck passed.
- Verifier: Vitest and tsgo exit code 0

## EvidenceBundleDraft

- Artifact key: task-2-release-smoke
- Type: test
- Source: pnpm exec node scripts/release-smoke.ts
- Summary: Desktop-only release manifest fixture regenerated its lockfile and all release smoke checks passed.
- Verifier: release-smoke exit code 0

## EvidenceBundleDraft

- Artifact key: task-3-typechecks
- Type: typecheck
- Source: vp run Desktop, contracts, and client-runtime typechecks
- Summary: Desktop and contracts typechecks passed; client-runtime typecheck passed with one pre-existing non-blocking Effect suggestion.
- Verifier: tsgo exit code 0 for all three packages

## EvidenceBundleDraft

- Artifact key: task-3-retirement-scan
- Type: inspection
- Source: rg Desktop remote owners plus git diff review
- Summary: Desktop SSH, WSL, server-exposure, connection-catalog, saved-environment, remote folder-picker, and splash owners/channels/preload methods are absent. Legacy SSH payload types remain only for the still-active client-runtime owner queued for Task 5; bootstrap Tailscale false fields remain queued for Task 4 server-contract retirement.
- Verifier: rg and direct diff inspection

## EvidenceBundleDraft

- Artifact key: task-3-desktop-regression
- Type: test
- Source: vp test focused Desktop local-environment suite
- Summary: 13 files and 79 tests passed for production loopback port selection, backend configuration/lifecycle, local auth, pool, environment, IPC, settings, updates, menu, window, and IPC contracts.
- Verifier: Vitest 4.1.9 exit code 0

## EvidenceBundleDraft

- Artifact key: task-4-loopback-runtime
- Type: test
- Source: server/config/bootstrap/dev-runner focused suites
- Summary: Server binds literal 127.0.0.1; public host/pair/connect/service/relay/Tailscale paths are absent; explicit CORS and HTTP(S) loopback dev URL rejection pass; full server suite passes 93/93.
- Verifier: codex-controller

## EvidenceBundleDraft

- Artifact key: task-4-auth-retirement
- Type: review
- Source: Task 4 spec and code-quality review loops
- Summary: Mounted local APIs retain bootstrap/browser/access-token/session-cookie/WebSocket/RPC auth while removing pairing/access-management/relay scopes; migration 040 removes the retired pairing table; independent spec and code-quality reviews approved.
- Verifier: codex-controller

## EvidenceBundleDraft

- Artifact key: task-4-regression
- Type: test
- Source: latest controller verification
- Summary: Latest direct verification: server.test.ts 93/93; 15 focused files 159/159; t3, contracts, desktop, and scripts typechecks pass. One over-parallelized subscribeShell timeout was isolated: the test passed in 240ms and the full server file passed 93/93, so no production timing patch was added.
- Verifier: codex-controller

## EvidenceBundleDraft

- Artifact key: task-5-client-contract-regression
- Type: test
- Source: vp focused Task 5 tests and package typechecks
- Summary: 24 focused files and 236 tests passed; contracts, client-runtime, Desktop, and server typechecks passed. Web diagnostics remain only in explicitly queued Task 6 renderer retirement callers.
- Verifier: Vitest 4.1.9 and tsgo exit code 0

## EvidenceBundleDraft

- Artifact key: task-5-independent-review
- Type: review
- Source: independent findings-first code-quality review and re-review
- Summary: Four Important findings in token ownership, failed-refresh coalescing, backend identity replacement, and Vite loopback enforcement were repaired at canonical owners; re-review found no remaining Critical or Important Task 5 defects.
- Verifier: independent reviewer Archimedes

## EvidenceBundleDraft

- Artifact key: task-6-renderer-regression
- Type: test
- Source: controller-owned Web and Shared tests, six package typechecks, Web production build, diff check, and retirement scan
- Summary: Web passed 192 files and 1760 tests; Shared passed 32 files and 280 tests. Web, Shared, client-runtime, contracts, Desktop, and server typechecks passed. Web production build transformed 4223 modules. Diff check passed, and retirement scan retained only SSH Git clone and unrelated pair terminology.
- Verifier: codex-controller; Vitest 4.1.9, tsgo, and Vite exit code 0

## EvidenceBundleDraft

- Artifact key: task-6-independent-review
- Type: review
- Source: independent specification and code-quality review loops
- Summary: Specification review approved after retiring the last orphaned provider-maintenance helper. Code-quality review found and verified fixes for unknown single-segment routes blanking an empty workspace and SWR usage refresh replacing existing data with a skeleton. Final re-review found no remaining findings.
- Verifier: independent reviewers Copernicus and Helmholtz

## EvidenceBundleDraft

- Artifact key: task-7-identity-regression
- Type: test and typecheck
- Source: controller-owned FD contracts/Desktop/server/Web/scripts suites and six package typechecks
- Summary: 38 focused files and 375 tests passed, including durable login cleanup, session-mismatch recovery, fail-closed logout, expired-session revocation, both remote crash windows, exact Runtime Token policy, bounded vault/config reads, fd6 protocol failures, IPC/preload secrecy, backend fd6 spawn, renderer-safe contract isolation, Web login gating, and development-bootstrap origin boundaries. Contracts, Desktop, server, Web, scripts, and shared package typechecks passed; server emitted only pre-existing non-blocking Effect suggestions.
- Verifier: Vitest 4.1.9 and tsgo exit code 0

## EvidenceBundleDraft

- Artifact key: task-7-build-release
- Type: build and release smoke
- Source: Web production build, server bundle, Desktop pack, build-script tests, and release-smoke
- Summary: A hostile-environment Web production build transformed 4,231 modules and completed in 15.77s while an inherited development bootstrap credential was present. The server bundle and Desktop main/preload pack completed, build-focused suites passed, and release smoke printed "Release smoke checks passed."
- Verifier: Vite, tsdown, tsgo, electron pack, and release-smoke exit code 0

## EvidenceBundleDraft

- Artifact key: task-7-retirement-scan
- Type: inspection
- Source: rg scans, production bundle scan, file metadata inspection, and git diff --check
- Summary: Fresh production scans found no renderer `runtimeApiKey`/`refreshCookie`, development bootstrap identifier or injected value, Clerk/T3 Cloud owner, or old `t3code://` scheme. The five FD source artworks are tracked and are the sole active source; old asset families and icon exporters are deleted. The enterprise config is non-ignored, Task 8 provider/text-generation owner diff is empty, the server package is private with no public repository/publish metadata, and git diff --check passed.
- Verifier: rg, file, and git exit code 0

## EvidenceBundleDraft

- Artifact key: task-7-independent-review
- Type: review
- Source: independent specification and code-quality review loops
- Summary: Identity specification and quality reviews approved after durable cleanup, mismatch recovery, broker drain, and token-deletion fixes. A separate branding and renderer-boundary specification review approved after tracking FD assets and retiring stale owners. Final code-quality review approved after adding direct auth-bootstrap boundary tests and correcting the Desktop-only workspace document.
- Verifier: independent reviewers and codex-controller

## EvidenceBundleDraft

- Artifact key: task-8a-responses-regression
- Type: test and typecheck
- Source: controller-owned protocol, credential-store, contracts, and Desktop regression suites on
  bundled Node 24 plus affected package typechecks
- Summary: Exact model/endpoint requests, stateless tools, malformed input, terminal states,
  response limits, cancellation/timeout, active credential invalidation, equivalent periodic
  refresh, expiry renewal, bounded validator caching, private origin projection, and renderer-safe
  contracts passed. Server diagnostics contained only pre-existing Effect suggestions.
- Verifier: Vitest 4.1.9, tsgo, and git diff check exit code 0

## EvidenceBundleDraft

- Artifact key: task-8a-real-probe
- Type: deployed integration
- Source: temporary exact-Flash Runtime Token projected only over child stdin to
  `probe:fd-responses`, with token deletion and session logout in `finally`
- Summary: The deployed FD New API passed exact `deepseek-v4-flash` identity, streaming text, usage,
  deterministic function call, stateless function output continuation, and cancellation. No
  reasoning summary was emitted in the sampled turn. The redacted probe emitted no credential,
  prompt, tool argument/result, or response content.
- Verifier: redacted probe matrix `status=PASS`; temporary script removed and token cleanup completed

## EvidenceBundleDraft

- Artifact key: task-8a-build-boundary
- Type: build, release smoke, and inspection
- Source: server bundle, Vite+ Web/server/Desktop task graph, release smoke, renderer production scans,
  private-contract export inspection, and exact lockfile review
- Summary: Web transformed 4,231 modules; server bundle and Desktop main/preload packs completed;
  release smoke passed. Web/server-client and preload production outputs contain no FD runtime API
  key, refresh cookie, access token, or private credential projection. Exact AI SDK/OpenAI/AJV
  versions are locked, and the private projection remains available only through its explicit
  contracts subpath.
- Verifier: Vite, tsdown, release-smoke, rg, package metadata, and lockfile inspection

## EvidenceBundleDraft

- Artifact key: task-8a-independent-review
- Type: review
- Source: independent specification and code-quality review loops
- Summary: Specification review approved after terminal-state, validated-tool-publication, and exact
  model metadata timing fixes. Code-quality review approved after active logout/policy invalidation,
  output-item structure bounds, aggregate schema budget, bounded validator cache, and generation-only
  refresh handling were repaired and re-reviewed.
- Verifier: independent reviewers Ramanujan and Newton plus codex-controller

## EvidenceBundleDraft

- Artifact key: task-10-managed-fd-skills-regression
- Type: test and typecheck
- Source: Task 10 focused suites, full Server suite, and five affected package typechecks
- Summary: 16 focused files and 343 tests passed. Full Server verification passed 162 files and 1,409 tests. Contracts, client-runtime, Desktop, Web, and Server typechecks passed. Coverage includes authorized/denied Skill catalog handling, `蔡梦晨`/`蔡梦辰` and zero-row semantics, retrying calls, duplicate/replayed SSE, audit IDs, stale running state, account-generation invalidation, new-account history reload, and new-chat/account reset behavior.
- Verifier: Vitest 4.1.9, tsgo, and git diff check exit code 0

## EvidenceBundleDraft

- Artifact key: task-10-build-boundary
- Type: build, smoke, release, and inspection
- Source: latest Server bundle, Web production build, Desktop task graph, Electron smoke, release smoke, and production artifact scans
- Summary: Server bundle, Web production build, Desktop main/preload pack, Desktop smoke, and release smoke passed. Sensitive runtime identifier count was 0 in `preload.cjs`, its sourcemap, Web production output, and bundled server client output. QA privacy count scans found 0 business-marker files and 0 runtime-secret-identifier files.
- Verifier: Vite+, tsdown, Electron smoke, release-smoke, rg, and git diff check

## EvidenceBundleDraft

- Artifact key: task-10-review-remediation
- Type: review and repair
- Source: independent specification review followed by local repair and regression verification
- Summary: The initial specification review identified three issues: account-generation ordering for queued volatile events, missing history reload for existing subscriptions after account switch, and replay contract mismatch where New API emits only an authoritative terminal state. Repairs add generation provenance, `reloadAllHistory`, and strict `replayed:true` terminal reconciliation with tool-card closure. Formal post-fix specification and independent code-quality verdicts remain pending.
- Verifier: reviewer findings, 343 focused tests, full Server suite, and five package typechecks

## EvidenceBundleDraft

- Artifact key: task-10-live-enterprise-qa
- Type: deferred integration
- Source: existing local endpoint and encrypted QA roots
- Summary: Live authenticated FD Skill query was not executed because `http://127.0.0.1:5734/` returned HTTP 502. No credentials, query inputs, or result values were printed or recorded.
- Verifier: curl status-only check and privacy scans with counts only

## EvidenceBundleDraft

- Artifact key: task-10-final-review-remediation
- Type: test, typecheck, and review repair
- Source: focused Enterprise runtime, ProviderCommandReactor, and FD Skill picker regressions
- Summary: The history loader now merges restored server messages with live non-history overlay content and staged turns, preventing a pending history response from erasing a streamed or completed assistant answer. The in-flight invalidation test uses Deferred readiness. Controller wiring proves an accepted FD turn is present only in the volatile Enterprise overlay, and picker revocation clears the selected version and sensitive composer draft. Server passed 6 files and 141 tests; Web passed 3 files and 81 tests; affected server/Web typechecks, formatter, and git diff checks passed.
- Verifier: Vitest 4.1.9, tsgo, Vite+ formatter, and git exit code 0

## EvidenceBundleDraft

- Artifact key: task-10-final-quality-gate
- Type: test, typecheck, and review
- Source: controller-focused Task 10 suites, affected package typechecks, formatter/diff checks, independent code-quality review and re-review
- Summary: Final Task 10 verification passed 12 focused files and 296 tests; contracts, client-runtime, Desktop, Web, and Server typechecks passed; formatter and git diff checks passed. Independent review found and verified fixes for bounded Enterprise requests, post-reset history revision monotonicity, cross-PubSub stale snapshot rejection, process-wide revision allocation after state reclamation, and bounded runtime metadata; final verdict READY with no Critical, Important, or Minor findings.
- Verifier: Vitest 4.1.9, tsgo, Vite+ formatter, git, independent reviewer task10_quality_review

## EvidenceBundleDraft

- Artifact key: task-11-final-quality-gate
- Type: test, typecheck, review, build, and visual-acceptance boundary
- Source: Task 11 focused Desktop, Server, Web, contracts, and client-runtime suites; five affected
  package typechecks; formatter/diff checks; independent specification and code-quality review
  loops; packaged Electron launch
- Summary: Final Task 11 verification passed 17 focused files and 174 tests. Server, Web,
  contracts, client-runtime, and Desktop typechecks passed; current Web production build, Server
  bundle, and Desktop main/preload pack passed; formatter and git diff checks passed. Independent
  review verified repairs for office worktree policy bypass, blank-draft startup, state-directory
  symlink escape, Settings entry points, and hidden-project leakage, with a final
  Critical/Important/Minor result of none. Web development and packaged Electron startup were
  observed, but required desktop and compact-laptop visual acceptance remains unverified because
  macOS UI automation timed out.
- Verifier: Vitest 4.1.9, tsgo, Vite+ formatter, git, specification reviewer task11_spec_review,
  code-quality reviewer task11_quality_review, and codex-controller

## EvidenceBundleDraft

- Artifact key: task-11a-codex-compatibility-local
- Type: test, typecheck, build, and credential-boundary inspection
- Source: restored Codex protocol/stdio/client and T3 adapter/session suites; FD routing, owner-lock, orchestration, persistence, managed-home, child-environment, local-Skill, and gated real-runtime tests
- Summary: Local Task 11A verification passed 14 files and 237 tests; the real App Server test was skipped by its explicit gate. Server, contracts, client-runtime, and effect-codex-app-server typechecks passed, as did the Server bundle. The hidden FD provider routes ordinary turns through Codex, preserves resume cursors, projects lifecycle events once, forwards approval/user-input/interrupt, locks both owner directions, and resolves project/personal Skills as structured Codex input. Runtime Token inspection found it only in the child environment; managed config, process arguments, stderr projection, runtime payloads, and restored source paths contain no credential value. Live exact-endpoint proof remains pending because FD_RUN_REAL_APP_SERVER, FD_CODEX_BINARY, and FD_NEW_API_KEY are unset and the global codex install lacks @openai/codex-darwin-x64.
- Verifier: Vitest 4.1.9, tsgo, Vite+ pack/formatter, git diff check, rg boundary scans, and codex --version failure inspection

## EvidenceBundleDraft

- Artifact key: task-11-task-directory-amendment
- Type: test, typecheck, build, migration, and live-startup inspection
- Source: task workspace real-filesystem tests; Web office/task and composer-draft regressions; five
  affected package typechecks; Web production build; Server bundle; restarted Desktop demo backend;
  SQLite projection schema and pre-first-send filesystem inspection
- Summary: The no-workspace flow now stages a unique task draft and allocates
  `~/FangdeAI/Tasks/YYYY-MM-DD-HH-mm-ss` only on first send. Typed task projects are excluded from
  workspace selectors while their conversations stay in the task list. Collision suffixing and
  empty-only failure cleanup passed real filesystem tests. Existing projection rows migrated to
  `project_purpose = 'workspace'`; the restarted backend returned HTTP 302 and the task root remained
  absent before first send. Focused verification passed 2 Web files/85 tests and 1 Server file/3
  tests, all five affected typechecks, the 4,221-module Web build, and the Server bundle.
- Verifier: Vitest 4.1.9, tsgo, Vite+, SQLite schema inspection, curl status check, and
  codex-controller
