import { describeActionError } from "~/rpc/transportError";

export function fileReadErrorPresentation(error: unknown): {
  message: string;
  canOpenWithSystemApp: boolean;
} {
  const fallback = { message: describeActionError(error), canOpenWithSystemApp: false };
  if (
    !error ||
    typeof error !== "object" ||
    !("_tag" in error) ||
    error._tag !== "ProjectReadFileError"
  ) {
    return fallback;
  }
  const failure = "failure" in error ? error.failure : undefined;
  const path =
    "relativePath" in error && typeof error.relativePath === "string"
      ? error.relativePath.replaceAll("\\", "/")
      : "";
  if (failure === "binary_file") {
    const isOfficeDocument = /\.(?:docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(path);
    return {
      message: isOfficeDocument
        ? "这是办公文档，当前文本预览无法显示。请用 Word、Excel、PowerPoint 或 WPS 等系统应用打开。"
        : "此文件不是纯文本，无法在文本编辑器中预览。PDF 请点击上方的浏览器预览按钮。",
      canOpenWithSystemApp: isOfficeDocument,
    };
  }
  if (failure === "workspace_path_outside_root" || failure === "resolved_path_outside_root") {
    return {
      message:
        "此链接指向当前任务文件夹之外，无法在这里预览。请让 AI 将成果保存到当前任务文件夹并提供新链接。",
      canOpenWithSystemApp: false,
    };
  }
  if (failure === "path_not_file") {
    return {
      message: "此链接指向文件夹，请从右侧文件列表选择具体文件。",
      canOpenWithSystemApp: false,
    };
  }
  if (/^(?:\.\/)?userdata\/codex-home\/skills\/[^/]+\/SKILL\.md$/i.test(path)) {
    return {
      message:
        "无法在当前任务文件夹中读取这份技能说明。这个链接指向 SKILL.md；如果需要查看生成结果，请让 AI 提供成果文件的真实链接，或从右侧文件列表选择。",
      canOpenWithSystemApp: false,
    };
  }
  if ("operation" in error && error.operation === "realpath-workspace-root") {
    return {
      message: "无法访问当前任务文件夹，请确认它未被移动、删除，且你有访问权限。",
      canOpenWithSystemApp: false,
    };
  }
  return {
    message:
      "无法读取此文件。它可能尚未生成、已被移动或删除，或当前没有访问权限。生成完成后可重新读取，也可从右侧文件列表确认实际文件位置。",
    canOpenWithSystemApp: false,
  };
}
