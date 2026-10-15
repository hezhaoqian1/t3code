import {
  AssetPreviewTypeValidationError,
  AssetWorkspaceAssetNotFoundError,
  AssetWorkspaceRootNormalizationError,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeOpenFileInPreviewError } from "./openFileInPreview";

const resource = {
  _tag: "workspace-file" as const,
  threadId: ThreadId.make("thread-1"),
  path: "C:\\Users\\fd\\FangdeAI\\Tasks\\2026-10-15-09-27-23\\report.html",
};

describe("describeOpenFileInPreviewError", () => {
  it("names the missing file", () => {
    expect(describeOpenFileInPreviewError(new AssetWorkspaceAssetNotFoundError({ resource }))).toBe(
      `找不到文件：${resource.path}。它可能已被移动、改名或删除。`,
    );
  });

  it("explains an unreachable task folder", () => {
    expect(
      describeOpenFileInPreviewError(
        new AssetWorkspaceRootNormalizationError({ resource, cause: new Error("ENOENT") }),
      ),
    ).toBe("无法访问这个任务的文件夹，它可能已被移动、改名或删除。");
  });

  it("explains which files the integrated browser opens", () => {
    expect(describeOpenFileInPreviewError(new AssetPreviewTypeValidationError({ resource }))).toBe(
      "内置浏览器只能打开 HTML、PDF 和图片文件。",
    );
  });

  it("falls back to the generic action description", () => {
    expect(describeOpenFileInPreviewError(new Error("预览窗口已关闭"))).toBe("预览窗口已关闭");
  });
});
