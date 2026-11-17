import {
  FD_RUNTIME_MODELS,
  FD_RUNTIME_SELECTABLE_MODELS,
} from "@t3tools/contracts/fd/runtime-credentials";
import { describe, expect, it } from "vite-plus/test";

import {
  FD_RESPONSES_MODEL_CATALOG,
  isFdResponsesModelAdvertised,
  resolveFdResponsesModelConfig,
} from "./ResponsesModelCatalog.ts";

describe("FD Responses model catalog", () => {
  it("names every selectable runtime model", () => {
    expect(FD_RESPONSES_MODEL_CATALOG.map((model) => model.slug)).toEqual([
      ...FD_RUNTIME_SELECTABLE_MODELS,
    ]);
  });

  it("offers Kimi K3.1 Pro and the two Claude models with native image input", () => {
    for (const [slug, name, shortName] of [
      ["kimi-k3.1-pro", "Kimi K3.1 Pro", "Kimi K3.1 Pro"],
      ["claude-fable-5-2", "Claude Fable 5.2", "Fable 5.2"],
      ["claude-opus-5-5", "Claude Opus 5.5", "Opus 5.5"],
    ] as const) {
      expect(isFdResponsesModelAdvertised(slug)).toBe(true);
      expect(resolveFdResponsesModelConfig(slug)).toMatchObject({
        slug,
        name,
        shortName,
        supportsTools: true,
        supportsVision: true,
        visionRoute: "native",
      });
    }
  });

  it("no longer advertises Kimi K3 but still reads tasks saved with it", () => {
    expect(isFdResponsesModelAdvertised("kimi-k3")).toBe(false);
    expect(FD_RUNTIME_MODELS).toContain("kimi-k3");
    // Offered again by the gateway, it would be handled like any server-authorized model.
    expect(resolveFdResponsesModelConfig("kimi-k3")).toMatchObject({
      slug: "kimi-k3",
      name: "kimi-k3",
      visionRoute: "native",
    });
  });
});
