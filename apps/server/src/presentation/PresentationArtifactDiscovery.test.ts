// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { discoverPresentationArtifacts } from "./PresentationArtifactDiscovery.ts";

describe("discoverPresentationArtifacts", () => {
  it("finds self-contained PPTD projects and their exported PPTX", async () => {
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "fd-presentation-discovery-"),
    );
    const project = NodePath.join(root, "presentations", "market-review");
    await NodeFSP.mkdir(NodePath.join(project, "pages"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(project, "market-review.pptd"),
      "version: v2\npages:\n  - pages/1.page\n  - pages/2.page\n",
    );
    await NodeFSP.writeFile(NodePath.join(project, "market-review.pptx"), "pptx");
    const [artifact] = await discoverPresentationArtifacts({ cwd: root, operation: "create" });
    expect(artifact).toMatchObject({
      label: "market review",
      pageCount: 2,
      operation: "create",
      pptxPath: NodePath.join(project, "market-review.pptx"),
      version: 2,
    });
  });

  it("keeps artifact identity stable and targets a selected project", async () => {
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "fd-presentation-selection-"),
    );
    const first = NodePath.join(root, "presentations", "first");
    const second = NodePath.join(root, "presentations", "second");
    await NodeFSP.mkdir(NodePath.join(first, "pages"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(second, "pages"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(first, "first.pptd"),
      "version: 1\npages:\n  - pages/1.page\n",
    );
    await NodeFSP.writeFile(
      NodePath.join(second, "second.pptd"),
      "version: 4\npages:\n  - pages/1.page\n",
    );

    const latest = await discoverPresentationArtifacts({ cwd: root, operation: "revise" });
    expect(latest).toHaveLength(1);
    const selected = await discoverPresentationArtifacts({
      cwd: root,
      operation: "revise",
      artifactId: latest[0]!.id,
    });
    expect(selected).toEqual(latest);

    await NodeFSP.utimes(
      latest[0]!.pptdPath,
      new Date(Date.now() + 2000),
      new Date(Date.now() + 2000),
    );
    const afterEdit = await discoverPresentationArtifacts({ cwd: root, operation: "revise" });
    expect(afterEdit[0]!.id).toBe(latest[0]!.id);
    expect(afterEdit[0]!.version).toBe(4);
  });
});
