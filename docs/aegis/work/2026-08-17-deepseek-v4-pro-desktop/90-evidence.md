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
