// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { FdServerRuntimeCredentialProjection } from "@t3tools/contracts/fd/runtime-credentials";

import { FdEnterpriseCodexClient } from "./FdEnterpriseCodexClient.ts";
import { executeFdEnterpriseToolCall } from "../fd-codex/FdCodexAdapter.ts";

const credentials: FdServerRuntimeCredentialProjection = {
  userId: 7,
  runtimeTokenId: 45,
  newApiOrigin: "https://fd.invalid",
  runtimeApiKey: "runtime-secret",
  accessToken: "access-secret",
  accessExpiresAt: 4_102_444_800,
  policy: {
    version: 1,
    capability: "general_assistant",
    model: "deepseek-v4-flash",
    expiresAt: 4_102_444_800,
  },
  generation: 1,
};
const auditId = "550e8400-e29b-41d4-a716-446655440009";
const reportHtml = "<!DOCTYPE html><html><body>报告</body></html>";
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const parseOutput = (text: string) =>
  decodeJson(text) as {
    readonly saved_files: ReadonlyArray<{
      readonly file_name: string;
      readonly path?: string;
      readonly error?: string;
    }>;
  };

function toolResult(downloadPath: string) {
  return {
    success: true,
    data: {
      tool_name: "holdings_report_render",
      audit_id: auditId,
      content: { status: "ok" },
      artifacts: [
        {
          id: "r1",
          file_name: "客户_高净客户私募持仓分析_20261020.html",
          mime_type: "text/html",
          size_bytes: 64,
          download_path: downloadPath,
        },
      ],
    },
  };
}

function gateway(downloadPath = "/api/fd-skills/desktop/reports/r1") {
  const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
  const client = new FdEnterpriseCodexClient({
    credentials: async () => credentials,
    fetch: async (url, init) => {
      requests.push({
        url: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.pathname === "/api/fd-skills/desktop/tool-calls") {
        return new Response(encodeJson(toolResult(downloadPath)), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(reportHtml, { headers: { "content-type": "text/html" } });
    },
  });
  return { client, requests };
}

const call = {
  skillVersionId: 9,
  releaseDigest: "a".repeat(64),
  clientThreadId: "550e8400-e29b-41d4-a716-446655440000",
  providerThreadId: "550e8400-e29b-41d4-a716-446655440001",
  turnId: "550e8400-e29b-41d4-a716-446655440002",
  callId: "call-1",
  tool: "holdings_report_render",
  arguments: { draft_id: "d1" },
  timeoutSeconds: 180,
};

describe("gateway tool artifacts", () => {
  it.effect("saves a generated report into the task folder and tells the model where", () =>
    Effect.gen(function* () {
      const taskFolder = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-task-")),
      );
      const { client, requests } = gateway();

      const first = yield* executeFdEnterpriseToolCall(client, call, { taskFolder });
      const second = yield* executeFdEnterpriseToolCall(client, call, { taskFolder });

      expect(first.success).toBe(true);
      const firstOutput = parseOutput(first.contentItems[0]!.text);
      const secondOutput = parseOutput(second.contentItems[0]!.text);
      expect(firstOutput.saved_files).toEqual([
        {
          file_name: "客户_高净客户私募持仓分析_20261020.html",
          path: "outputs/客户_高净客户私募持仓分析_20261020.html",
        },
      ]);
      expect(secondOutput.saved_files[0]!.path).toBe(
        "outputs/客户_高净客户私募持仓分析_20261020 (2).html",
      );
      const saved = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(taskFolder, firstOutput.saved_files[0]!.path!), "utf8"),
      );
      expect(saved).toBe(reportHtml);
      expect(
        requests.filter((request) => request.url.startsWith("/api/fd-skills/desktop/reports/")),
      ).toHaveLength(2);
      expect(requests.every((request) => request.authorization === "Bearer access-secret")).toBe(
        true,
      );
    }),
  );

  it.effect("refuses download paths outside the report endpoint", () =>
    Effect.gen(function* () {
      const taskFolder = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-task-")),
      );
      const { client, requests } = gateway("/api/user/self");

      const output = yield* executeFdEnterpriseToolCall(client, call, { taskFolder });

      expect(parseOutput(output.contentItems[0]!.text).saved_files[0]!.error).toContain(
        "保存到任务文件夹失败",
      );
      expect(requests.map((request) => request.url)).toEqual(["/api/fd-skills/desktop/tool-calls"]);
      const outputs = yield* Effect.promise(() => NodeFSP.readdir(taskFolder));
      expect(outputs).toEqual([]);
    }),
  );
});
