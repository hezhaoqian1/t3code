# Desktop File Analysis V1 - Intent

## TaskIntentDraft

- Requested outcome: Enable one-off analysis of common local files in the Desktop task composer and verify it with real files and the deployed FD API.
- Goal: Ordinary Desktop turns can analyze bounded local document context while existing image input, Web behavior, and enterprise Skill permissions remain unchanged.
- Success evidence: parser tests, real local Office/text probes, deployed Responses API reachability, FD Skill fail-closed regression, typechecks, production build, and Electron smoke test.
- Stop condition: Done for the Desktop V1 slice when the evidence bundle is complete; Windows physical UI and OCR remain outside this environment.
- Non-goals: Web document picker, knowledge base/RAG, OSS file storage, enterprise database-file execution, OCR rollout, or provider-specific file protocols.

## BaselineReadSetHint

- `docs/aegis/plans/2026-08-19-desktop-file-analysis-v1.md`
- `FD-gateway/docs/aegis/specs/2026-08-19-desktop-file-analysis-v1-design.md`
- Existing image attachment persistence and FD enterprise runtime boundaries.

## ImpactStatementDraft

- Server owns validation, safe persistence, parsing, bounded `DocumentContext`, and provider input normalization.
- Desktop owns selection, display, drag/drop, and temporary upload state; Web remains image-only by default.
- FD Skill document attachments fail closed before enterprise staging or provider session creation.
