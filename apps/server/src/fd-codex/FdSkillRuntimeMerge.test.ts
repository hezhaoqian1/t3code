import { describe, expect, it } from "vite-plus/test";

import type { FdEnterpriseCodexRuntimeContext } from "../fd-skills/FdEnterpriseCodexClient.ts";
import { mergeFdSkillRuntimeContexts } from "./FdCodexAdapter.ts";

function runtimeContext(input: {
  readonly versionId: number;
  readonly displayName: string;
  readonly tools: ReadonlyArray<{ readonly name: string; readonly timeoutSeconds?: number }>;
}): FdEnterpriseCodexRuntimeContext {
  return {
    protocol: "fd-codex-runtime-v1",
    release_digest: String(input.versionId).padStart(64, "0"),
    skill: {
      version_id: input.versionId,
      version: "1.0.0",
      name: `skill-${input.versionId}`,
      display_name: input.displayName,
      kind: "database",
      risk_tier: "high",
    },
    developer_instructions: `instructions of ${input.displayName}`,
    references: [],
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: `${tool.name} of ${input.displayName}`,
      input_schema: { type: "object" },
      ...(tool.timeoutSeconds !== undefined ? { timeout_seconds: tool.timeoutSeconds } : {}),
    })),
  };
}

const productData = runtimeContext({
  versionId: 10004,
  displayName: "FD数据资源",
  tools: [{ name: "fd_data_query" }, { name: "fd_holdings_get_latest" }],
});
const marketData = runtimeContext({
  versionId: 10012,
  displayName: "宏观与市场数据",
  tools: [{ name: "ft_v1_economic_china_cpi" }, { name: "fd_market_call_tool" }],
});
const holdingsReport = runtimeContext({
  versionId: 10008,
  displayName: "高净客户持仓报告",
  tools: [{ name: "fd_data_query" }, { name: "fd_holdings_report_render", timeoutSeconds: 240 }],
});

describe("mergeFdSkillRuntimeContexts", () => {
  it("passes a single Skill through unchanged", () => {
    const merged = mergeFdSkillRuntimeContexts([productData]);

    expect(merged.developerInstructions).toBe("instructions of FD数据资源");
    expect(merged.tools).toEqual(productData.tools);
    expect(merged.ownerOf("fd_data_query")).toEqual({
      skillVersionId: 10004,
      releaseDigest: productData.release_digest,
      timeoutSeconds: undefined,
    });
  });

  it("offers every Skill's tools and calls each through the Skill that owns it", () => {
    const merged = mergeFdSkillRuntimeContexts([productData, marketData]);

    expect(merged.tools.map((tool) => tool.name)).toEqual([
      "fd_data_query",
      "fd_holdings_get_latest",
      "ft_v1_economic_china_cpi",
      "fd_market_call_tool",
    ]);
    expect(merged.ownerOf("fd_data_query")).toMatchObject({
      skillVersionId: 10004,
      releaseDigest: productData.release_digest,
    });
    expect(merged.ownerOf("ft_v1_economic_china_cpi")).toMatchObject({
      skillVersionId: 10012,
      releaseDigest: marketData.release_digest,
    });
    expect(merged.ownerOf("view_image")).toBeUndefined();
  });

  it("keeps each Skill's instructions and names the tools it owns", () => {
    const instructions = mergeFdSkillRuntimeContexts([
      productData,
      marketData,
    ]).developerInstructions;

    expect(instructions).toContain("同时启用了 2 个 FD Skill：「FD数据资源」、「宏观与市场数据」");
    expect(instructions).toContain('<fd_skill index="1" name="FD数据资源">');
    expect(instructions).toContain("本 Skill 的工具：fd_data_query、fd_holdings_get_latest");
    expect(instructions).toContain("instructions of FD数据资源");
    expect(instructions).toContain('<fd_skill index="2" name="宏观与市场数据">');
    expect(instructions).toContain("instructions of 宏观与市场数据");
    expect(instructions.indexOf("instructions of FD数据资源")).toBeLessThan(
      instructions.indexOf("instructions of 宏观与市场数据"),
    );
  });

  it("gives a tool several Skills offer to the first of them, once", () => {
    const merged = mergeFdSkillRuntimeContexts([productData, holdingsReport]);

    expect(merged.tools.map((tool) => tool.name)).toEqual([
      "fd_data_query",
      "fd_holdings_get_latest",
      "fd_holdings_report_render",
    ]);
    expect(merged.tools[0]?.description).toBe("fd_data_query of FD数据资源");
    expect(merged.ownerOf("fd_data_query")).toMatchObject({ skillVersionId: 10004 });
    expect(merged.ownerOf("fd_holdings_report_render")).toEqual({
      skillVersionId: 10008,
      releaseDigest: holdingsReport.release_digest,
      timeoutSeconds: 240,
    });
    expect(merged.developerInstructions).toContain("本 Skill 的工具：fd_holdings_report_render");
  });

  it("sends a tool no Skill offers to the first Skill so the gateway refuses it", () => {
    const merged = mergeFdSkillRuntimeContexts([productData, marketData]);

    expect(merged.fallbackOwner).toEqual({
      skillVersionId: 10004,
      releaseDigest: productData.release_digest,
      timeoutSeconds: undefined,
    });
  });

  it("needs at least one Skill", () => {
    expect(() => mergeFdSkillRuntimeContexts([])).toThrow();
  });
});
