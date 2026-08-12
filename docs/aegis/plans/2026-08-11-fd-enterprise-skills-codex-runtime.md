# FD Enterprise Skills Through Codex App Server

## Goal

Move Desktop managed FD Skill execution from the server-side Enterprise Agent model loop to the
local Codex App Server while retaining FD New API as the only authority for identity, Skill release
projection, data authorization, Connector credentials, row/column policy, masking, and audit.

The existing Web `/api/agent/turns` protocol and Web management UI remain unchanged.

## User Outcome

- Employees select an FD Skill from the existing composer control.
- The selected Skill runs in the same Codex App Server harness as ordinary Desktop work.
- Codex receives only the authorized Skill instruction/reference projection and tool schemas.
- Every enterprise data tool call returns to FD New API and is reauthorized and audited there.
- Database credentials, Connector identity, access groups, and raw authorization grants never enter
  Desktop, Codex configuration, prompts, logs, or Git.
- The four supplied business questions can be answered against the approved MySQL data through the
  real Desktop path.

## Architecture

```text
FD AI Desktop composer
  -> FdDeepSeekAdapter selects managed Skill version
  -> FD New API POST /api/fd-skills/desktop/runtime-context
  -> Codex App Server thread/start
       developerInstructions = authorized Skill release projection
       dynamicTools = authorized schemas only
  -> item/tool/call
  -> FD New API POST /api/fd-skills/desktop/tool-calls
       authenticated user -> CreateFDToolCapability -> Execute
       reauthorize -> validate SQL -> row/column policy -> query -> mask -> audit
  -> bounded tool result -> Codex -> Desktop timeline

Existing Web:
  /api/agent/turns -> EnterpriseAgentRuntime (unchanged)
```

## Source And Ownership Boundaries

- `FD-gateway/apps/new-api/model/fd_skill_desktop_runtime.go` owns the immutable runtime projection,
  release digest, tool schemas, and execution facade.
- `FD-gateway/apps/new-api/controller/fd_skill.go` owns authenticated HTTP DTO validation only.
- `FDToolCapability.Execute` remains the canonical data authorization and audit owner.
- `t3code-fd-impl/apps/server/src/fd-skills/FdEnterpriseCodexClient.ts` owns bounded Desktop transport
  parsing and credential use.
- `CodexSessionRuntime` owns App Server dynamic tool registration and request/response routing.
- `CodexAdapter` only wires per-session runtime options.
- `FdDeepSeekAdapter` only chooses the local or managed-Codex execution path. It does not execute SQL.

## Compatibility Boundary

- Do not change the request/response or SSE behavior of `/api/agent/turns`.
- Do not change `/api/fd-skills/self`, current Web admin APIs, or existing management tables.
- Additive Desktop endpoints require normal `UserAuth`; they never accept user id, group, Connector
  id, credential reference, resource grants, or policy from the Desktop/model.
- Existing local Skills continue through normal Codex Skill discovery.
- A managed Skill is fixed for a conversation; changing runtime still requires a new conversation.
- A revoked/changed release fails closed at context load or the next tool call.

## Runtime Projection Contract

`POST /api/fd-skills/desktop/runtime-context`

Input: `skill_version_id`, `client_thread_id`.

Output: protocol version, release digest, Skill metadata, bounded developer instructions, immutable
reference projection, and dynamic tool definitions. The response excludes Connector topology,
credentials, subject grants, row predicates, and internal policy identifiers.

`POST /api/fd-skills/desktop/tool-calls`

Input: `skill_version_id`, `release_digest`, `client_thread_id`, `provider_thread_id`, `turn_id`,
`call_id`, `tool`, and `arguments`.

The server rebuilds authorization from the authenticated user, verifies the release digest and tool
membership, then calls `FDToolCapability.Execute`. Output is bounded JSON content plus audit metadata.

## Immutable Release Boundary

Desktop runtime context is a canonical JSON projection of the published version instruction,
references, and tool schemas, identified by a SHA-256 release digest. The tool endpoint recomputes
the authorized projection and rejects stale digests. This prevents a resumed Codex thread from using
schemas or instructions that no longer match server policy without changing current Web reads.

This phase does not migrate the existing mutable admin storage to a new publishing system. A future
admin publishing task may persist immutable release bundles and version-owned references; until then,
the digest check is the fail-closed compatibility boundary.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: none; the user did not request strict/test-first TDD.
- Test posture: focused post-change Go and Effect/Vitest regression, followed by live database and
  packaged Desktop acceptance.

## Change Necessity

- User-visible need: Desktop enterprise Skills must have Codex-quality Agent behavior without local
  database credentials or bypassing FD authorization.
- No-change / non-code option: the old project ZIP or current server Agent can run the work, but
  neither delivers both Codex App Server behavior and centralized FD policy.
- Why code change is necessary: App Server needs an authenticated runtime projection and dynamic
  tool callback; New API needs explicit Desktop endpoints for those operations.
- Minimum change boundary: two additive Gateway endpoints, one bounded Desktop client, and wiring in
  the existing Codex runtime/adapter/FD router.
- Decision: code-change.

## Complexity Budget

- Artifact class: cross-repo protocol/security integration.
- Gateway: add one model owner and focused controller/router additions; avoid adding model behavior
  to the controller or duplicating `FDToolCapability`.
- Desktop: add one transport owner; keep Codex runtime changes generic and FD adapter changes to
  execution routing.
- Generated protocol: do not edit generated schema. Use a local experimental thread-start extension
  decoded back through the generated response schema.
- Budget result: within-budget if no new SQL executor, credential store, Web Agent branch, or second
  Skill picker is introduced.

## Execution Tasks

### Task 1: Gateway Runtime Projection

1. Add bounded request/response models and canonical digest construction.
2. Reuse `CreateFDToolCapability`, `AgentContext`, `Definitions`, and `Execute`.
3. Add authenticated Desktop runtime-context and tool-call controllers/routes.
4. Add tests for authorization, digest stability/staleness, response redaction, revocation, tool
   allowlisting, bounded arguments/results, and successful audit-backed execution.

### Task 2: Desktop Transport And Codex Dynamic Tools

1. Add a bounded `FdEnterpriseCodexClient` using the existing runtime credential projection.
2. Extend `CodexSessionRuntimeOptions` with developer instructions, dynamic tools, and executor.
3. Send the experimental `dynamicTools` field through the raw typed transport boundary and decode
   the response with the generated schema.
4. Handle `item/tool/call`, verify it belongs to the active provider thread, call the executor, and
   return bounded `DynamicToolCallResponse` content.
5. Add protocol/runtime tests for registration, successful calls, failure responses, wrong-thread
   rejection, and ordinary-session non-regression.

### Task 3: Managed Skill Routing

1. Fetch authorized context before starting a managed Codex session.
2. Start the ordinary Codex adapter with managed per-session runtime options.
3. Route send, interrupt, approval, user input, read, rollback, and stop operations to that session.
4. Fail closed on unavailable/revoked/stale Skill context. Do not fall back to the old model loop.
5. Preserve the existing composer picker and new-conversation runtime lock.

### Task 4: Regression And Live Acceptance

1. Run Gateway model/controller/service tests and build/type checks.
2. Run Desktop contracts, App Server package, Server, Web, and Desktop focused suites/type checks.
3. Confirm existing Web `/api/agent/turns` tests and routes are unchanged and green.
4. Configure the supplied MySQL only through server-side secret handling; inspect schema read-only.
5. Run the four supplied questions through the real managed Skill path and verify audits.
6. Launch the Desktop and perform real GUI acceptance with screenshots: login, Skill selection,
   workspace/no-workspace task, tool progress, Chinese answer, and history/restart behavior.

### Task 5: Evidence And Delivery

1. Update Aegis checkpoint, drift, evidence, and architecture records in the Desktop repository.
2. Record Gateway API contract and deployment ordering.
3. Run final verification and independent diff review.
4. Commit Gateway and Desktop changes separately with scoped Conventional Commit messages.

## Stop Conditions

- Stop if the installed Codex App Server rejects documented `dynamicTools` after capability opt-in.
- Stop if authorized database Views cannot answer a supplied question without changing business
  definitions or data grants.
- Stop if the Desktop path requires sending credentials, Connector IDs, group membership, or raw
  row-policy predicates to Codex.
- Do not claim completion without real tool-call audit evidence and GUI screenshots.

## Evidence Required

- Official OpenAI App Server documentation for experimental dynamic tools.
- Gateway tests proving auth/revocation/digest/audit behavior.
- Desktop tests proving dynamic tool routing and ordinary Skill compatibility.
- Four real question results with audit IDs recorded in a secret-free evidence form.
- Desktop screenshots and a restart/history observation.
- Git diffs showing Web Agent protocol and management routes were not modified.

## Legacy Codex Business Workspace Migration

The supplied `Codex_Business_Workspace_v1.0.0.zip` is treated as the parity source, not as a
runtime bundle to unpack into employee machines. Its four `.agents/skills` packages, knowledge
base, question examples, templates, and business rules are published as FD-managed Skill assets
in New API. The local `tools/db_tool.py`, Python environments, `.env.local`, connection profiles,
and database passwords are deliberately excluded from the Desktop project.

| Legacy asset                                           | FD AI owner                           | Desktop behavior                                                                                   |
| ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `company-data-quality`                                 | Published FD Skill version            | Select from `业务能力`; Codex App Server receives only the authorized instruction and tool schemas |
| `company-database-query`                               | Published FD Skill version            | Dynamic tool calls return to New API for authorization, masking, and audit                         |
| `company-knowledge-helper`                             | Published FD Skill version            | Uses the bounded published references in the runtime projection                                    |
| `company-report-writing`                               | Published FD Skill version            | Runs in the same managed Codex conversation and can use authorized results                         |
| `knowledge/`, `questions/`, `templates/`               | Skill references and published assets | No credentials or connector topology are sent to the client                                        |
| `tools/db_tool.py`, `.env.local`, virtual environments | Retired from Desktop execution        | Database access is server-side only through `FDToolCapability`                                     |

This preserves the old employee workflow while moving its trust boundary to FD Gateway. Existing
Web `/api/agent/turns`, Web administration, and management storage remain unchanged. Standard local
`SKILL.md` packages continue to work through normal Codex discovery; only the four reserved FD names
are claimed by the managed catalog so a local package cannot shadow an enterprise capability.
