// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);

export async function convertLegacyOffice<T>(
  bytes: Buffer,
  extension: "doc" | "ppt",
  consume: (path: string, extension: "docx" | "pptx") => Promise<T>,
  platform: NodeJS.Platform,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const candidates =
    platform === "win32"
      ? [
          "C:/Program Files/LibreOffice/program/soffice.exe",
          "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
        ]
      : platform === "darwin"
        ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
        : ["/usr/bin/libreoffice", "/usr/bin/soffice"];
  let executable: string | undefined;
  for (const candidate of candidates) {
    if (
      await NodeFSP.access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      executable = candidate;
      break;
    }
  }
  if (!executable)
    throw new Error("旧版 DOC/PPT 需要安装 LibreOffice，或先另存为 DOCX/PPTX 后上传。");
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-office-"));
  const target = extension === "doc" ? "docx" : "pptx";
  try {
    const source = NodePath.join(directory, `source.${extension}`);
    await NodeFSP.writeFile(source, bytes);
    const profile = NodePath.join(directory, "profile");
    await NodeFSP.mkdir(NodePath.join(profile, "user"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(profile, "user", "registrymodifications.xcu"),
      '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>',
    );
    // A private profile prevents reuse of a user's running office session.
    await execute(
      executable,
      [
        `-env:UserInstallation=${NodeURL.pathToFileURL(NodePath.join(directory, "profile")).href}`,
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--convert-to",
        target,
        "--outdir",
        directory,
        source,
      ],
      { timeout: 45_000, maxBuffer: 64 * 1024, windowsHide: true, ...(signal ? { signal } : {}) },
    );
    const output = NodePath.join(directory, `source.${target}`);
    if ((await NodeFSP.stat(output)).size > 25 * 1024 * 1024)
      throw new Error("转换后的文档超过 25 MB，请拆分后上传。");
    return await consume(output, target);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}
