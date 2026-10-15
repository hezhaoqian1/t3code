import { describe, expect, it } from "vite-plus/test";
import { ProjectReadFileError } from "@t3tools/contracts";
import { fileReadErrorPresentation } from "./fileReadError";

const error = (
  relativePath: string,
  failure: "binary_file" | "operation_failed" | "resolved_path_outside_root" | "path_not_file",
  operation?: "realpath-target" | "realpath-workspace-root",
) =>
  new ProjectReadFileError({
    cwd: "C:/Users/employee/FangdeAI/Tasks/task",
    relativePath,
    failure,
    ...(operation ? { operation } : {}),
  });

describe("file read error presentation", () => {
  it("explains the screenshot's task-relative skill link", () => {
    const result = fileReadErrorPresentation(
      error(
        "userdata/codex-home/skills/product-note-update/SKILL.md",
        "operation_failed",
        "realpath-target",
      ),
    );
    expect(result.message).toContain("技能说明");
    expect(result.message).toContain("成果文件的真实链接");
    expect(result.canOpenWithSystemApp).toBe(false);
  });

  it.each(["报告.docx", "报表.XLSX", "汇报.pptx", "旧版.doc", "文档.odt"])(
    "offers a system application for a confirmed binary office document: %s",
    (path) => {
      expect(fileReadErrorPresentation(error(path, "binary_file"))).toMatchObject({
        canOpenWithSystemApp: true,
      });
    },
  );

  it.each(["程序.exe", "脚本.cmd", "文件.bin", "报告.pdf"])(
    "does not offer an executable or unknown binary to the system: %s",
    (path) => {
      expect(fileReadErrorPresentation(error(path, "binary_file")).canOpenWithSystemApp).toBe(
        false,
      );
    },
  );

  it("keeps missing files and paths outside the workspace out of the system-open fallback", () => {
    for (const failure of ["operation_failed", "resolved_path_outside_root"] as const) {
      expect(fileReadErrorPresentation(error("报告.docx", failure)).canOpenWithSystemApp).toBe(
        false,
      );
    }
    expect(fileReadErrorPresentation(error("报告.md", "operation_failed")).message).toContain(
      "重新读取",
    );
    expect(
      fileReadErrorPresentation(error("报告.md", "resolved_path_outside_root")).message,
    ).toContain("之外");
  });

  it("distinguishes unavailable task folders and directories from missing files", () => {
    expect(
      fileReadErrorPresentation(error("报告.md", "operation_failed", "realpath-workspace-root"))
        .message,
    ).toContain("无法访问当前任务文件夹");
    expect(fileReadErrorPresentation(error("outputs", "path_not_file")).message).toContain(
      "选择具体文件",
    );
  });

  it("preserves connection guidance for transport errors", () => {
    expect(fileReadErrorPresentation(new Error("bird is not connected.")).message).toContain(
      "本地服务正在连接",
    );
  });
});
