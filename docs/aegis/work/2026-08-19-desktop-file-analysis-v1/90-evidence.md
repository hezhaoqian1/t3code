# Desktop File Analysis V1 - Evidence

## Focused regression

- `pnpm exec vp test run apps/server/src/fileAnalysis/DocumentParser.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
- Result: 2 files, 49 tests passed.
- Coverage: UTF-8 text, real XLSX container, corrupted XLSX rejection, citation source labels, and FD Skill document rejection before provider session creation.
- Contract regression: `packages/contracts/src/orchestration.test.ts`, 41 tests passed.

## Typechecks and build

- `pnpm --filter t3 typecheck`, `pnpm --filter @t3tools/web typecheck`, and `pnpm --filter @t3tools/desktop typecheck` passed with the bundled Node 24.19.0 runtime. Server typecheck emits one existing Effect diagnostic at `apps/server/src/fd-codex/FdCodexAdapter.ts:84` but exits successfully; that line is unchanged by this slice.
- `pnpm --filter t3 build:bundle` passed and produced the Server bundle.
- `pnpm --filter @t3tools/web build` passed and produced the Web production bundle.
- `pnpm --filter @t3tools/desktop smoke-test` passed: `Desktop smoke test passed.`
- `git diff --check` passed.
- `pnpm exec vp fmt --check` passed.

## Real local files

- Repository XLSX `outputs/server-sizing-20260730/FD-Gateway服务器配置评估.xlsx`: 2 sections and 2,233 extracted characters.
- A PDF generated from that real XLSX with LibreOffice: 5 sections and 9,436 extracted characters through `officeparser@7.8.0/pdf`.
- A real DOCX generated from the repository Markdown solution document: 1 section and 1,048 extracted characters through `officeparser@7.8.0/docx`.
- Only metadata was printed; document body text was not logged or committed.

## Deployed API

- `GET https://ai-api.fdsure.com/api/status` returned HTTP 200 and reported New API commit `8692a696...`.
- An unauthenticated `POST https://ai-api.fdsure.com/v1/responses` returned HTTP 401 (`Invalid token`), confirming the public route is reachable and authentication is enforced. No credential was available in this shell, so an authenticated model turn was not repeated in this run.
- The earlier authenticated Responses probe remains recorded in the prior evidence bundle; it verifies the deployed route, not end-to-end deployment of this uncommitted Desktop branch.

## Boundaries and residual risk

- Web document UI was not enabled.
- FD Skill document attachments are rejected in the Decider before sensitive enterprise staging; the ProviderCommandReactor retains a defense-in-depth check.
- OCR is intentionally unavailable in V1. Physical Windows UI and packaged Windows parsing were not run on a Windows host.
- No new Desktop artifact was published before this branch was reviewed and merged.
