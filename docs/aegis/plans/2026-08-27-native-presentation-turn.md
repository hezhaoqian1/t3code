# Goal

Make the presentation capability feel native to FD AI Desktop while preserving ordinary chat semantics. A user can request or revise a presentation from the existing thread, the current turn selects the managed presentation Skill internally, and the result is represented as a durable thread artifact.

# Architecture

Reuse the existing orchestration thread, ProviderRuntime, Codex adapter, composer, and Desktop IPC. Add a typed per-turn capability selection and pass it through the existing command/event/provider path. Keep PPTD as the editable source and PPTX as the delivery artifact. Do not create a second Agent loop or a second conversation.

# Tech Stack

TypeScript, Effect Schema, existing FD orchestration contracts, React composer, Electron main/preload IPC, bundled presentation runtime and local PPTD exporter.

# Baseline/Authority Refs

- `docs/architecture/fd-presentation-capability.md`
- `docs/aegis/plans/2026-08-27-fd-presentation-capability.md`
- `/Users/windupbird/.codex/skills/open-kimi-ppt/SKILL.md`
- Existing `thread.turn.start` and `ProviderSendTurnInput` contracts

# Compatibility Boundary

Existing local Skills, FD enterprise Skills, ordinary chat, Feishu connector Skills, and remote runtimes must continue to work. User-visible messages must not contain implementation tokens or upstream branding. A presentation selection applies to one turn only.

# TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression plus focused end-to-end verification
- Reason: the user requested implementation and real local validation, not strict test-first development.
- Verification: focused contract, adapter, UI, IPC, package, and real DeepSeek generation/export checks.

# Change Necessity

- User-visible need: native, context-aware presentation generation and revision.
- No-change option: keep prompt token injection and standalone configuration modal.
- Why code change is necessary: prompt text cannot safely carry hidden one-turn capability state or durable presentation references.
- Minimum boundary: orchestration turn metadata, provider skill selection, composer UX, artifact/result projection, and desktop editor/export bridge.
- Decision: code-change.

# Existence Check

- Proposed new surface: per-turn capability selection and presentation artifact projection.
- Existing owner / reuse candidate: `thread.turn.start`, `ProviderSendTurnInput`, existing message/activity projection, existing Desktop IPC.
- Why existing surface is insufficient: current contracts only carry enterprise skill ids and local Skills are inferred from visible `$` tokens; no first-class presentation artifact exists.
- Creation proof: hidden selection must survive server eventing and provider dispatch without mutating user text; artifact references must survive editor close and later turns.
- Entropy / retirement impact: no second runtime owner; remove the visible token path from the presentation action once hidden selection is active.
- Decision: add-with-proof, reusing existing owners.

# Tasks

1. Add typed `presentation` capability selection to client/server/provider turn contracts and route it to native Skill resolution without changing persisted user text.
2. Replace the presentation action's visible Skill token with hidden selection metadata and progressive-disclosure defaults.
3. Register presentation outputs as first-class thread artifacts and render a chat result card with open/edit/download actions.
4. Add recent-artifact lookup and natural-language revision routing, including version-safe editor close/save behavior.
5. Run focused checks, launch the local Desktop stack, use the configured DeepSeek key, generate a real deck from the supplied DOCX, export PPTX, render page images, and inspect every page before declaring completion.

# Risks

- Existing event fixtures may require optional-field compatibility updates.
- The current UI may not yet have a generic artifact renderer; use the nearest existing result projection rather than inventing a parallel store.
- Real-model output can vary; validation must check both structural validity and visual quality.
- The supplied API key must remain in environment variables only and must never be committed or printed.

# Retirement

After hidden selection and artifact routing are live, delete the presentation action's visible `$fd-presentation-studio` prompt insertion. Keep the managed package and local exporter as the runtime owner.

# Verification

- Focused contracts and adapter tests pass.
- Presentation capability resolver and IPC tests pass.
- Existing touched-package typechecks pass.
- Real DeepSeek run produces a self-contained PPTD project and valid PPTX.
- Image QA overview and representative full-resolution pages show no overflow, clipping, or unreadable text.
