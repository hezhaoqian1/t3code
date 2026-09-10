# FD AI Desktop Context Architecture

Date: `2026-09-10`

Status: core implementation verified locally; desktop release pending.

## Decision

Reuse the provider lifecycle already present in T3 Code. Codex app-server owns
model-visible history and compaction. The local T3 server owns product history,
projections, UI state, and persisted resume cursors. The renderer must not
reconstruct a prompt from visible messages.

This replaces the initial proposal for a separate context coordinator and
binding database. `ProviderSessionDirectory` and `ProviderSessionRuntime` already
provide those boundaries. FD extends their opaque resume cursor for its execution
profiles instead of adding another source of truth.

The reference upstream is `pingdotgg/t3code`, inspected at
`d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4`. Relevant work includes native compaction
(`#9293`, `#10112`) and metadata-only thread resume. Port relevant behavior without
importing retired providers or unrelated UI changes.

## Ownership

| Layer                 | Responsibility                                                     |
| --------------------- | ------------------------------------------------------------------ |
| Electron and renderer | Existing tasks, messages, attachments, Skill selection             |
| T3 local server       | Commands, projections, provider routing, resume cursor persistence |
| Codex app-server      | Active context, tool loop, rollout files, summaries, compaction    |
| FD gateway            | Model routing and image preprocessing where required               |
| FD enterprise service | Skill authorization, instructions, authorized tools, audit         |

Both ordinary desktop tasks and managed FD Skills use local Codex app-server.
The legacy enterprise `/api/agent/turns` loop is not the current desktop Skill
path. Skill authorization is fetched before starting or resuming its session.

## Resume And Switching

Each product task keeps an opaque provider cursor. FD stores a versioned envelope
with independent cursors for `local` and each `enterprise:<skillVersionId>`.
The active top-level `threadId` remains compatible with existing cursor readers.
Switching back resumes that profile's history. Ordinary conversation and different
Skill versions do not silently share instructions, tools, or history.

Legacy unversioned cursors have no trustworthy Skill provenance and restore as
local context only. Invalid bindings and unknown envelope versions start with empty
profile cursors, without reassigning one Skill's history to another profile.
The existing FD placeholder is not a provider cursor.

All currently advertised FD models share one managed Responses runtime, so the
adapter declares in-session model switching. The old unsupported flag caused T3
to clear the cursor on model changes after the gateway migration. Runtime identity
checks still apply to genuinely different provider environments.

`thread/resume` uses `excludeTurns: true` and decodes only thread identity, working
directory, and model. Unknown historical item formats cannot break metadata
decoding. Following the requested recovery UX and T3's fallback behavior, confirmed
missing rollouts automatically start a new provider thread. Authorized Skill tools
and instructions are reapplied, and the new cursor replaces the unusable cursor.
Product history is retained, but the model starts with fresh context. Transient
network and authorization failures do not trigger this fallback.

The product task ID indexes visible history; the Codex `threadId` in `resumeCursor`
indexes persisted model history. `turnId` identifies one agent turn. `requestId`
correlates an operation and its result; it does not store conversation context.

## Compaction

The existing context meter offers a compact action. `/compact` reaches the same
command path and preserves the selected managed FD Skill. The native adapter
capability calls `thread/compact/start`.

An RPC acknowledgement or ordinary turn completion alone is not success.
`thread/compacted` and completed context-compaction items provide evidence.
The service correlates that evidence with the initiating message. When Codex
creates an internal compaction turn, FD consumes its lifecycle and waits for its
completion so it does not create an assistant turn or file checkpoint. Automatic
compaction during an ordinary turn remains in the ordinary runtime flow.

Only one manual compaction runs per task. New sends and duplicates are blocked.
Failure is visible, stopping ends the provider session, and a ten-minute timeout
blocks further sends until the session is stopped and restarted. A late compaction
event alone does not unlock a timed-out session.
Success clears the pending-turn projection and restores the composer to ready.

Compaction retains a model-generated summary, not every original token. Product
history remains visible independently. Images, extracted files, and tool results
may be summarized; critical details can still need to be supplied again.

## Window Policy

The meter reports the runtime window and current usage. Cumulative processed
tokens are separate. A runtime window is not automatically a vendor's advertised
maximum: unknown model names may receive Codex fallback metadata.

This change does not invent official limits or claim the full upstream window is
enabled. DeepSeek currently advertises 1M context. Gateway aliases, output reserve,
and the other vendors' limits require verification before applying per-model
metadata. A global override must not give Kimi or Qwen a DeepSeek limit.

Verified metadata belongs in the existing Responses model catalog, with its source
and verification date, delivered through Codex's documented model catalog support.
Do not introduce an unused policy registry or duplicate adapter capability flags.

## UI, Skills, And Images

The task layout, attachment workflows, Skills, tools, approvals, and presentation
entry points remain. Compaction is disabled during other operations, unresolved
approvals, draft content, and selected native Skill/presentation input. A selected
managed FD Skill remains attached to the compaction request.

DeepSeek image preprocessing and Kimi native image forwarding retain their existing
routes. Context management does not make a text-only model accept images.

## Validation And Release

Focused tests cover cursor serialization, profile isolation and restoration,
model switching, missing history, metadata-only resume, compaction correlation,
overlap, stop, timeout, internal turn handling, projections, and Skill input.

The real integration test uses temporary state, bundled Codex 0.147.0, and the
authorized FD gateway. It sends a codeword, invokes a local Skill, compacts, stops,
resumes, and verifies the codeword, then switches the same thread to Kimi and
verifies it again. This passed on 2026-09-10. It proves the tested flow, not every
model at its maximum context length.

The Electron integration pass also logged in as the authorized administrator,
sent a codeword to V4 Flash, clicked the context meter's compact action, observed
the completed activity, and verified the codeword in the next response. Manual
compaction activities have no synthetic turn association, so they remain visible
instead of disappearing inside a collapsed work-step group. The measured runtime
window in that test was 258,400 tokens, not DeepSeek's advertised 1M maximum.

Server and renderer typechecks passed. The focused nine-file regression run passed
237 tests; the provider service tests were rerun after the Electron-discovered
activity fix. Targeted lint still reports pre-existing test-runtime/import violations
in touched test files. The standard Windows build wrapper encountered a Chinese-path
encoding error in `node --run`; direct `vp pack` produced the server bundle and the
successful renderer build was copied into its local client directory for Electron QA.

Release requires focused server/renderer checks, integrated UI verification, and
a newly built desktop artifact. Updating the remote gateway alone does not install
these local provider and UI changes for desktop users.

## Longer-Term Boundaries

Task summaries are already app-server compaction artifacts. A project/user memory
editor, automatic cross-task memory, and cross-provider summary migration are
separate product features, not prerequisites for T3's context lifecycle. They are
not implemented here. Such memory needs explicit inspection, deletion, ownership,
and retention controls.

Shared app-server mechanics do not guarantee equal reasoning quality, tool
reliability, model limits, or lossless memory across models.

## References

- https://github.com/pingdotgg/t3code
- https://developers.openai.com/codex/app-server/
- https://developers.openai.com/codex/config-reference/
- https://code.claude.com/docs/en/how-claude-code-works
- https://api-docs.deepseek.com/quick_start/pricing
- `docs/aegis/plans/2026-08-11-fd-enterprise-skills-codex-runtime.md`
