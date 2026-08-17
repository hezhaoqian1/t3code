# DeepSeek V4 Pro Desktop - Evidence

## Task 1: Exact Model Authorization

- Command: focused contracts and Desktop identity tests.
- Result: 3 files and 63 tests passed.
- Coverage: exact Flash/Pro projection, legacy Flash-only compatibility, managed token upgrade, and arbitrary-model rejection.

## Task 2: Runtime Routing

- Command: focused Responses client, Agent kernel, FD adapter, driver, text-generation, and managed Codex tests.
- Result: 6 files and 134 tests passed.
- Command: `vp run --filter t3 typecheck`.
- Result: passed; one pre-existing Effect diagnostic suggestion remains in `FdCodexAdapter.ts`.
- Command: targeted formatter and `git diff --check`.
- Result: passed.
- Coverage: exact Pro request body and metadata, Flash-only credential rejection, model-list lease invalidation, each-round kernel routing, same-task Pro-to-Flash Codex switching, two-model snapshot, and Flash-only helper generation.

## Task 3: Composer Selection

- Command: focused model-selection, `FdModelSelector`, send-context logic, and composer draft tests.
- Result: 4 files and 121 tests passed.
- Command: `vp run --filter @t3tools/web typecheck`.
- Result: passed.
- Coverage: advertised Pro preservation, Flash default, arbitrary/unadvertised model rejection, exact two-option rendering, and existing composer `ModelSelection` state ownership.

## Task 4: Real Desktop And Feishu QA

- Real Desktop Pro text response returned `PRO MODEL OK`; switching the same task to Flash returned `FLASH MODEL OK`.
- SQLite turn events recorded `deepseek-v4-pro` for the first turn and `deepseek-v4-flash` for the second turn.
- Pro and Flash each completed a `pwd` tool call through the Codex harness. Tool activity was summarized as “查看项目结构” instead of showing raw shell noise.
- The bundled Feishu CLI reports version `1.0.86`, and the application contains 27 official Feishu Skills.
- Feishu device authorization cancellation returned the connector to `enabled=false` with `lastError=null`; real Desktop QA confirmed no red notification.
- The employee screenshot showed the company account disabled by Feishu because the current CLI application lacks permission in the Fangde enterprise tenant. This requires tenant-admin authorization and is not a Desktop identity-cache defect.

## Task 4: Release Verification

- Coverage audit: 20 of 23 identified Pro/Feishu paths covered (87%). Direct Pro-to-Flash Responses switching, cancellation during Feishu application setup, and nonzero logout after successful identity removal are covered.
- Full package tests: Desktop 401, Web 1752, Server 1509, Client Runtime 466, Contracts 211, Effect Codex App Server 20, Shared 266, and Scripts 153 tests passed. One existing Server test remained conditionally skipped.
- Full repository typecheck passed. The existing non-blocking Effect suggestion in `apps/server/src/fd-codex/FdCodexAdapter.ts` remains unchanged.
- Production build, Electron smoke, release smoke, repository format check, and `git diff --check` passed.
- Full-repository lint still reports existing baseline violations across FD Codex, test-runtime, Sidebar, and bundled Feishu Skill files. No newly introduced production behavior failed typecheck or build; lint debt is not being mixed into this release.
- GitHub Actions run `31996596289` completed successfully from merged `main` and produced the exact seven-file `fd-desktop-release-0.2.9` bundle for macOS arm64 and Windows x64.
- The FD Gateway internal-unsigned publisher verified both packages, updater manifests, architectures, application metadata, and SHA-256 sums before atomically activating 0.2.9. The retained rollback target is 0.2.7.
- Public `latest.json`, `latest-mac.yml`, `latest.yml`, `SHA256SUMS`, all four versioned assets, and the two stable website aliases accepted byte-range requests. Both updater manifests advertise version `0.2.9`.
- A fresh macOS DMG launch reported bundle version `0.2.9`, started the local Agent Server, created the main window, rendered both `V4 Flash` and `V4 Pro`, and accepted a switch to Pro.
- The packaged Feishu connector refreshed to `CLI 1.0.86 · 27 个官方 Skills` with the recoverable `需要授权飞书账号` state and no red error notification.
- Remaining external verification: a real Fangde tenant administrator must authorize the Feishu CLI application before an enterprise account can be selected; final Windows shortcut/restart acceptance still requires a Windows machine.
