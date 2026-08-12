# FD Enterprise Skills Through Codex App Server - Evidence

## Architecture Evidence

- Official Codex App Server `dynamicTools` support is used on `thread/start` with `capabilities.experimentalApi=true`; calls arrive as `item/tool/call` and are answered with content items.
- Desktop requests only a published, authorized runtime projection from New API. The projection contains Skill instructions, published references, dynamic-tool JSON schemas, and a release digest; it excludes Connector credentials, row-scope internals, subject identifiers, and database topology.
- Every dynamic tool call returns to New API `/api/fd-skills/desktop/tool-calls`. New API rebuilds the user's current capability, checks the release digest and allowed tool, applies SQL/resource policy and masking, executes through the Connector, and persists the audit before returning data.
- Ordinary local Skills remain in the same business-capability catalog and execute through the local Codex App Server.
- Web remains on the existing `/api/agent/turns` Enterprise Agent runtime. The Gateway change only adds `/api/fd-skills/desktop/runtime-context` and `/api/fd-skills/desktop/tool-calls`; no Web management DTO or route was changed.

## Real Desktop Acceptance

Acceptance used Fangde AI Desktop, the QA account, the local Codex App Server, Gateway at `http://127.0.0.1:3001`, and the authorized Gateway views. No direct database credential was supplied to Codex.

1. Q2 2026 management fees
   - 渠道: `5,504,534.22`, 1,817 records
   - 机构: `3,065,231.00`, 1,135 records
   - Total: `8,569,765.22`
   - Audits: `20c705fb-4303-4ccf-9638-6816dde74d24`, `b736d54b-f1b7-4cde-a950-68ff401cebc1`
   - Screenshot: `screenshots/01-q2-management-fee.png`

2. Product `AVQ27B`
   - 鸣石省心享未来52号量化私募证券投资基金B类
   - Private fund; manager 上海鸣石投资管理有限公司
   - Open Wednesday/Thursday; dates `2026-08-06` through `2026-08-07`
   - Size: `415,079,259.24`
   - Audit: `65d075d5-836c-4902-8890-40c030a0d8bc`
   - Screenshot: `screenshots/02-product-avq27b.png`

3. Salesperson `史留萍`, July 2026
   - Type 22: 2
   - Type 20: 0
   - Audits: `55a220bd-bf60-4d73-a504-af970230b493`, `83ad7567-b36a-4c67-a866-9f4f2c1baf11`, `f4a2b8bc-f1f0-4792-9691-dc9648d946a6`
   - Screenshot: `screenshots/03-salesperson-orders.png`

4. Latest holdings for `蔡梦晨`
   - Latest date: `2026-08-10`
   - 6 records; total `6,955,300.14`
   - Matched customers: 1; duplicate groups: 0; invalid amounts: 0; `truncated=false`
   - Audit: `9dcd3cbb-58e2-4ab9-8f9a-c0436adec4fd`
   - Screenshot: `screenshots/04-latest-holdings.png`

The task directory `/Users/windupbird/FangdeAI/Tasks/2026-08-12-00-21-41` contains the generated SQL and CSV artifacts and remained present after acceptance.

## Audit Reconciliation

- All seven audit rows belong to `user_id=34` and `skill_version_id=4`.
- Every row has `status=succeeded`, the expected tool/resource name, matching turn/call linkage, expected row count, `truncated=0`, and an empty error code.
- Q1 used `codex_acl.v_commission_mgt_summary_manager` with row counts 2 and 1.
- Q2 used `codex_acl.v_sales_fund_manager` with row count 1.
- Q3 used `codex_acl.v_sales_orders_manager` with row counts 1, 1, and 7.
- Q4 used the latest-holdings tool over authorized holdings/customer resources with row count 6.
- Inspected audit metadata contained no raw SQL, hidden rows, passwords, runtime tokens, or Connector credentials.

## Restart And History

- The real Fangde AI window was closed and relaunched from `/Users/windupbird/Documents/FD Gateway/t3code-fd-impl/apps/desktop/.electron-runtime/Fangde AI.app`.
- The authenticated account session recovered without a new login.
- The sidebar recovered 16 tasks.
- Reopening the latest FD Skill task restored the complete holdings answer, audit ID `9dcd3cbb-58e2-4ab9-8f9a-c0436adec4fd`, and `truncated=false`.

## Verification Commands

- Gateway focused runtime tests: `go test ./model -run 'TestFDSkillDesktop' -count=1` passed.
- Gateway controller/router tests: `go test ./controller ./router` passed.
- Server runtime tests: 6 files, 92 tests passed.
- Codex protocol package: 4 files, 20 tests passed.
- Desktop shell/identity/window tests: 3 files, 44 tests passed.
- Web focused regression: 7 files, 133 tests passed.
- Contracts: 17 files, 210 tests passed.
- Typechecks: Server, Web, Desktop, and contracts passed.
- Builds: Server bundle and Web production build passed. Web emitted only existing sourcemap/chunk-size warnings.
- Whitespace validation: `git diff --check` passed in both Gateway and Desktop worktrees.

## Disclosed Limits

- The broader Gateway `go test ./model ./controller ./router` run is not fully green because the pre-existing SQLite test `TestDeletedWorkspaceAgentClientThreadBindingCanBeRecreated` lacks the `workspace_message_feedbacks` table. Focused Desktop runtime tests and controller/router tests are green.
- One external/live App Server integration test is skipped by the suite. The actual local App Server path was exercised in the real Desktop acceptance above.
- A user-supplied MySQL copy at `172.16.0.73/j3db` ends at `2025-12-19` and cannot reproduce the authoritative 2026 acceptance rows. Acceptance therefore used the Gateway-authorized `codex_acl` views; it did not bypass New API policy.
