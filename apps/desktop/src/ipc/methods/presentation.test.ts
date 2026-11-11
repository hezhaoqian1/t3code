// @effect-diagnostics nodeBuiltinImport:off - the editor path check works on host file URLs like the code under test.
import { describe, expect, it } from "@effect/vitest";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as IpcChannels from "../channels.ts";
import {
  isPathInside,
  isPresentationEditorUrl,
  PRESENTATION_EDITOR_CHANNELS,
} from "./presentation.ts";

describe("presentation IPC path boundary", () => {
  it("allows only a task project or its descendants", () => {
    expect(
      isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks/deck"),
    ).toBe(true);
    expect(isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks")).toBe(
      true,
    );
    expect(
      isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/FangdeAI/Tasks-other/deck"),
    ).toBe(false);
    expect(isPathInside("/Users/employee/FangdeAI/Tasks", "/Users/employee/.ssh")).toBe(false);
  });
});

describe("presentation editor IPC access", () => {
  const editorPath = NodePath.join(
    NodeOS.tmpdir(),
    "方德 AI",
    "resources",
    "presentation",
    "fd-presentation-studio",
    "editor",
    "index.html",
  );
  const editorUrl = NodeURL.pathToFileURL(editorPath);

  it("lets the editor read and save its project, and nothing else", () => {
    expect([...PRESENTATION_EDITOR_CHANNELS].toSorted()).toEqual(
      [
        IpcChannels.PRESENTATION_READ_PROJECT_CHANNEL,
        IpcChannels.PRESENTATION_WRITE_FILE_CHANNEL,
      ].toSorted(),
    );
  });

  it("recognizes the bundled editor page whatever its query or hash", () => {
    const withQuery = new URL(editorUrl);
    withQuery.searchParams.set("desktopProjectPath", "C:\\Users\\员工\\FangdeAI\\Tasks\\deck");
    withQuery.searchParams.set("sdkMode", "ppt-editor");
    withQuery.hash = "slide-2";
    for (const url of [editorUrl.href, withQuery.href]) {
      expect(isPresentationEditorUrl({ editorPath, platform: "linux", url })).toBe(true);
    }
    expect(
      isPresentationEditorUrl({
        editorPath,
        platform: "win32",
        url: editorUrl.href.replace("index.html", "INDEX.html"),
      }),
    ).toBe(true);
  });

  it("rejects any other page the editor window could navigate to", () => {
    const sibling = NodeURL.pathToFileURL(
      NodePath.join(NodePath.dirname(editorPath), "other.html"),
    );
    for (const url of [
      sibling.href,
      `https://example.com${editorUrl.pathname}`,
      `fdai://app${editorUrl.pathname}`,
      "about:blank",
      "data:text/html,<p>hi</p>",
      "not a url",
    ]) {
      expect(isPresentationEditorUrl({ editorPath, platform: "linux", url }), url).toBe(false);
    }
    expect(
      isPresentationEditorUrl({
        editorPath,
        platform: "linux",
        url: editorUrl.href.replace("index.html", "INDEX.html"),
      }),
    ).toBe(false);
  });
});
