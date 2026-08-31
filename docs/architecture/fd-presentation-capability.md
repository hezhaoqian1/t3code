# FD Presentation Capability

## Product boundary

`制作 PPT` is a first-party desktop capability. Employees use a normal composer action and receive an editable presentation project plus a `.pptx`; upstream implementation names are not part of the product contract.

## Runtime flow

1. The Desktop host resolves `resources/presentation/manifest.json` (packaged) or the repository resource directory (development).
2. It passes the parent presentation directory as `fdPresentationSkillRoot` and the child runtime through `FD_PRESENTATION_NODE`.
3. The server registers `fd-presentation-studio` as a managed Native Skill. Managed roots have higher precedence than project, user, and connector roots, so a user Skill cannot shadow the first-party capability.
4. Composer inserts the FD-branded brief and selects the managed Skill while reusing the current attachment set.
5. The existing AgentRuntime/DeepSeek adapter performs document understanding and emits the editable PPTD project.
6. Main-process IPC can export only a project inside the employee task workspace by invoking the pinned local WASM worker with Electron's bundled Node.

## Distribution and integrity

The pinned capability is copied into desktop release `extraResources/presentation`. The manifest includes a SHA-256 of the skill directory (excluding the manifest itself). Cache installation uses a staging directory, verifies the package before activation, atomically swaps the version, and retains a previous version until activation succeeds. Optional Ed25519 fields are verified when present; unsigned development fixtures are permitted, while release pipelines should require signatures.

## Security boundaries

- Renderer code cannot execute commands or choose an arbitrary exporter.
- Main process allowlists the exporter path and rejects project paths outside `FangdeAI/Tasks`.
- Backend remains bound to `127.0.0.1` and receives only the managed root through the existing bootstrap contract.
- The worker runs offline with `--no-sign`; no employee cookie, external API, `npx`, Python, or system browser is required for PPTX export.

## Quality and provenance

The package contains the complete PPTD editor, references, tests, patched WASM, and a bundled YAML parser so clean machines can export without Python. `THIRD_PARTY_NOTICES.txt` retains the upstream MIT notice. Before public commercial distribution, complete dependency, font, image, WASM, and trademark provenance review remains required.

## Why this is not a marketplace install

PPT is a high-frequency, branded workflow with a large runtime package and a strict quality bar. It is therefore preloaded or silently managed by Desktop. A future marketplace can expose optional long-tail capabilities, but it should not be the first-run path for a non-technical employee.
