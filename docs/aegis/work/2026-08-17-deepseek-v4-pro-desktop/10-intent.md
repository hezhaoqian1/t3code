# DeepSeek V4 Pro Desktop - Intent

## TaskIntentDraft

- Requested outcome: Add a Flash-default, Pro-selectable model control immediately left of send and route the exact selected model through the managed FD Codex runtime.
- Goal: Add a Flash-default, Pro-selectable model control immediately left of send and route the exact selected model through the managed FD Codex runtime.
- Success evidence:
- Focused tests, typechecks, build, live Flash and Pro Responses smokes, desktop visual QA, merged release and public manifests.
- Stop condition: Done when all evidence passes; otherwise stop as blocked, needs-verification, or scope-exceeded without silent fallback.
- Non-goals:
- Add OCR, image understanding, new providers, API key UI, or restore the generic T3 model picker.
- Scope: Desktop FD provider model authorization, runtime routing, composer selector, tests, docs and release.
- Change kinds:
- feature
- Risk hints:
- Credential allowlist and per-turn runtime selection cross an internal trust boundary; Pro costs and concurrency differ from Flash.

## BaselineReadSetHint

- docs/aegis/plans/2026-08-17-deepseek-v4-pro-desktop.md
- https://api-docs.deepseek.com/guides/responses_api
- https://api-docs.deepseek.com/quick_start/pricing

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/plans/2026-08-17-deepseek-v4-pro-desktop.md
- https://api-docs.deepseek.com/guides/responses_api
- https://api-docs.deepseek.com/quick_start/pricing
- Acknowledged before plan:
- docs/aegis/plans/2026-08-17-deepseek-v4-pro-desktop.md
- https://api-docs.deepseek.com/guides/responses_api
- https://api-docs.deepseek.com/quick_start/pricing
- Cited in plan:
- docs/aegis/plans/2026-08-17-deepseek-v4-pro-desktop.md
- https://api-docs.deepseek.com/guides/responses_api
- https://api-docs.deepseek.com/quick_start/pricing
- Missing refs:
- none
- Advisory decision: continue

## ImpactStatementDraft

- Compatibility boundary: Old projections remain Flash-only; Web enterprise runtime and image behavior are unchanged.
- Affected layers:
- desktop identity, contracts, server provider, Codex runtime, web composer, release
- Owners:
- fd-deepseek provider and managed credential projection
- Invariants:
- Only exact Flash and Pro may be selected; Flash remains default; no silent model fallback.
- Non-goals:
- Add OCR, image understanding, new providers, API key UI, or restore the generic T3 model picker.

These records are Method Pack drafts / hints, not authoritative runtime decisions.
