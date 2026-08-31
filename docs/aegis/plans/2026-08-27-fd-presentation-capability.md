# FD AI Presentation Capability

## Problem

Employees need a near-native, zero-setup presentation workflow in Fangde AI Desktop. The current `open-kimi-ppt` Skill has proven that PPTD generation, visual QA, and PPTX export work locally, but its upstream CLI assumes a developer environment and exposes implementation details that are inappropriate for non-technical employees.

## User outcome

An employee can attach a Word/PDF/PPTX/image source or describe a topic, choose a company presentation style, and receive an editable PPTD project plus PPTX from the normal Fangde AI task workspace. The UI never asks the employee to install Node, Python, Chromium, a package, or an API key.

## Decisions

- Product name: `PPT 制作` / `方德演示`.
- Product surface: built-in first-party capability, available from the composer and attachment actions.
- Distribution: managed capability package. The first-party package is preloaded in enterprise installers when possible and can be downloaded on demand by the desktop runtime when not present.
- Runtime owner: reuse the existing desktop `AgentRuntime` and managed Skill catalog. Do not create a second desktop Agent loop.
- Export owner: a self-contained Node/Electron-compatible export worker, with the patched PPTD WASM and editor assets pinned by manifest. No runtime `npx`, Python, or browser installation.
- Governance: signed manifest, SHA-256 package verification, version pinning, atomic install, rollback, and admin/AI access-group visibility.
- Compatibility: ordinary chat, existing local Skills, Feishu connector Skills, and enterprise remote runtime contracts remain unchanged.
- Upstream licensing: retain MIT notices in a third-party notices artifact; remove upstream branding from employee-facing UI and product metadata. Commercial release requires a separate license/provenance audit before public sale.

## Scope

### In scope

1. Managed presentation capability descriptor and package manifest.
2. Desktop capability resolver with built-in resource lookup, cache, SHA-256 validation, atomic install, and rollback-safe replacement.
3. Presentation request contract: source attachments, style, page range, template, image policy, animation policy, and output artifacts.
4. Composer/attachment UX for first-party PPT creation and progress/result states.
5. Local export bridge that invokes the pinned exporter without external setup.
6. Result artifact registration for `.pptx`, `.pptd`, page previews, and source media.
7. Focused tests, desktop typecheck, and a local end-to-end fixture using the existing trial deck.

### Out of scope for this change

- Open third-party marketplace, billing, or public developer SDK.
- Rewriting the complete PPTD editor in this slice.
- Replacing all upstream editor/WASM code before the license audit.
- Supporting arbitrary user-installed executable plugins.

## File map

- `packages/contracts/src/presentation.ts`: shared request, manifest, progress, and artifact contracts.
- `packages/contracts/src/index.ts`: export presentation contracts.
- `apps/server/src/presentation/PresentationCapability.ts`: capability descriptor and local package resolver.
- `apps/server/src/presentation/PresentationCapability.test.ts`: resolver and validation tests.
- `apps/server/src/fd-skills/NativeSkillCatalog.ts`: register the managed presentation identity without allowing collisions.
- `apps/web/src/components/chat/PresentationAction.tsx`: attachment action and request composer UI.
- `apps/web/src/components/chat/PresentationAction.test.tsx`: UI state tests.
- `apps/desktop/resources/presentation/`: pinned capability manifest, exporter worker, WASM/editor assets, and third-party notices.
- `apps/desktop/src/presentation/PresentationExportBridge.ts`: typed Main-process export bridge.
- `apps/desktop/src/presentation/PresentationExportBridge.test.ts`: path, hash, and failure tests.
- `apps/desktop/src/app/desktop-ipc.ts` (or current typed IPC owner): expose the bridge through allowlisted IPC.
- `docs/architecture/fd-presentation-capability.md`: runtime and distribution contract.

## Verification

- Contract and resolver unit tests reject invalid manifests, path traversal, hash mismatch, oversized packages, and incomplete artifacts.
- Desktop bridge tests verify only allowlisted commands/resources can execute and that failures do not leave a partial install.
- Web tests verify the employee-facing action labels and progress/result states without exposing upstream names.
- Run `vp test run` for touched packages, `vp run typecheck`, and the presentation fixture export.
- Render the fixture deck with the local exporter and inspect representative page images plus PPTX ZIP integrity.

## Risks and mitigations

- Upstream editor/WASM provenance: keep notices and version pins; block external sale pending audit.
- Package tampering: signed manifest and SHA-256 validation before activation.
- Large installers: package only the pinned runtime assets; make optional editor assets on-demand.
- Export failures on clean machines: use Electron's bundled Node/Chromium and no system dependencies.
- Duplicate runtime owners: route through existing AgentRuntime/managed Skill catalog.

## Retirement

The current developer-only `npx open-kimi-ppt-skill` path remains a local authoring/QA tool. It is not exposed to employees. When the self-contained exporter is proven on all supported desktop targets, remove any production path that shells out to external `npx`/Python and keep the upstream trial artifact only as a test fixture.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression plus focused contract tests
- Reason: the user requested implementation quality, not strict test-first development.
- Verification: commands listed above and fresh fixture export evidence.
