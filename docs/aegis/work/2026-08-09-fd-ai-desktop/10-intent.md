# FD AI Desktop implementation - Intent

## TaskIntentDraft

- Requested outcome: Convert T3 Code into FD AI Desktop with FD identity, DeepSeek, native Skills, FD Skills, and only one authenticated local Desktop environment.
- Goal: Ship and verify the complete FD AI Desktop design.
- Success evidence:
- Desktop production bundle contains no mobile, relay, SSH, Tailscale, WSL, remote pairing, Clerk, or third-party provider path.
- Real FD login, DeepSeek Flash, native Skill, and audited FD Skill workflows pass.
- Packaged server is authenticated and loopback-only.
- Stop condition: Done only with plan-wide evidence; otherwise record blocked, needs-verification, or scope-exceeded state.
- Non-goals:
- Remote access or multi-device continuity.
- Employee-configurable providers or API keys.
- Scope: Execute docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md across workspace, runtime, UI, security, release, and verification.
- Change kinds:
- architecture
- retirement
- implementation
- Risk hints:
- Large compile ripple from remote/provider retirement.
- DeepSeek Responses tool compatibility requires a real protocol spike.
- Enterprise authorization and local persistence owners must not overlap.

## BaselineReadSetHint

- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: Retain FD APIs and T3 local workbench; retire all remote, mobile, cloud, Clerk, and third-party provider compatibility.
- Affected layers:
- workspace
- desktop
- server
- contracts
- renderer
- persistence
- release
- Owners:
- Electron main identity and process owner
- T3 local server
- FdDeepSeekDriver
- FD New API and Tool Gateway
- Invariants:
- One authenticated loopback-only Desktop environment.
- Only FD-managed deepseek-v4-flash is callable.
- FD data authorization remains server-side and audited.
- Each turn settles exactly once.
- Non-goals:
- Remote access or multi-device continuity.
- Employee-configurable providers or API keys.

These records are Method Pack drafts / hints, not authoritative runtime decisions.

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md
- Delivered context refs:
- none
- Acknowledged before plan:
- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md
- Cited in plan:
- docs/aegis/specs/2026-08-09-fd-ai-local-desktop-design.md
- docs/aegis/plans/2026-08-09-fd-ai-desktop-implementation.md
- docs/aegis/baseline/2026-08-09-initial-baseline.md
- docs/internals/overview.md
- docs/internals/providers.md
- docs/internals/environment-auth.md
- docs/internals/remote.md
- Missing refs:
- none
- Advisory decision: continue
