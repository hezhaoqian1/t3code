import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "./config.ts";
import {
  deriveTaskFolderLabel,
  formatTaskWorkspaceDirectoryName,
  prepareTaskWorkspace,
  TASK_FOLDER_LABEL_MAX_LENGTH,
  removeEmptyTaskWorkspace,
} from "./taskWorkspace.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "fd-task-workspace-config-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("taskWorkspace", (it) => {
  describe("formatTaskWorkspaceDirectoryName", () => {
    it("names the folder 任务名_年-月-日_时-分 with a stable collision suffix", () => {
      // Folder times are local: build the instant from local parts.
      // @effect-diagnostics-next-line globalDate:off
      const createdAt = new Date(2026, 10, 11, 15, 20, 46).toISOString();
      const directoryName = formatTaskWorkspaceDirectoryName({
        createdAt,
        title: "帮我分析一下这个基金的持仓情况，并生成报告",
      });

      expect(directoryName).toBe("分析一下这个基金的持仓情况_2026-11-11_15-20");
      expect(
        formatTaskWorkspaceDirectoryName({
          createdAt,
          title: "帮我分析一下这个基金的持仓情况，并生成报告",
          suffix: 1,
        }),
      ).toBe(`${directoryName}_2`);
    });
  });

  describe("deriveTaskFolderLabel", () => {
    it.each([
      // The request itself, without polite openers.
      ["请帮我整理本周销售周报", "整理本周销售周报"],
      ["你好，麻烦帮我做一份年度培训计划。谢谢", "做一份年度培训计划"],
      ["我想要对比三家基金公司的费率！", "对比三家基金公司的费率"],
      // Only the first sentence, and its first clause when that says enough.
      ["分析附件里的客户名单，按地区汇总，再画柱状图", "分析附件里的客户名单"],
      ["生成PPT，10页", "生成PPT"],
      // Spaces and symbols become hyphens; letters and digits stay.
      ["Build a Q3 sales/ops report", "Build-a-Q3-sales-ops"],
      ['把 "合同.docx" 转成 PDF', "把-合同-docx-转成-PDF"],
      // Full-width characters fold to ASCII; emoji and Windows-illegal characters go.
      ["整理ＡＢＣ数据🙂<>:*?|", "整理ABC数据"],
      // The client's 50-character truncation marker is dropped.
      [
        "一二三四五六七八九十一二三四五六七八九十一二三四五...",
        "一二三四五六七八九十一二三四五六七八九十",
      ],
      // FD Skills title their threads with a fixed label, never the query.
      ["FD Skill 对话", "FD-Skill-对话"],
      // Nothing usable left.
      ["🙂🙂", "新任务"],
      ["", "新任务"],
      [undefined, "新任务"],
    ])("derives %j as %j", (title, expected) => {
      expect(deriveTaskFolderLabel(title)).toBe(expected);
    });

    it("keeps names short and free of characters Windows or shells trip on", () => {
      for (const title of [
        "请帮我把这份很长很长的说明文档里面所有的表格都提取出来然后汇总",
        "a$b%c&d'e`f#g;h,i(j)k[l]m{n}o",
      ]) {
        const label = deriveTaskFolderLabel(title);
        expect(Array.from(label).length).toBeLessThanOrEqual(TASK_FOLDER_LABEL_MAX_LENGTH);
        expect(label).toMatch(/^[一-龥A-Za-z0-9-]+$/u);
        expect(label.startsWith("-") || label.endsWith("-")).toBe(false);
      }
    });
  });

  it.effect("allocates unique persistent directories under the configured task root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fd-task-workspace-" });
      const taskWorkspaceRoot = path.join(tempRoot, "FangdeAI", "Tasks");
      const taskConfig = ServerConfig.make({ ...config, taskWorkspaceRoot });
      // @effect-diagnostics-next-line globalDateInEffect:off
      const createdAt = new Date(2026, 7, 11, 14, 47, 46).toISOString();
      const title = "整理本周销售周报";
      const directoryName = formatTaskWorkspaceDirectoryName({ createdAt, title });

      const first = yield* prepareTaskWorkspace({ createdAt, title }).pipe(
        Effect.provideService(ServerConfig.ServerConfig, taskConfig),
      );
      const second = yield* prepareTaskWorkspace({ createdAt, title }).pipe(
        Effect.provideService(ServerConfig.ServerConfig, taskConfig),
      );

      const canonicalTaskWorkspaceRoot = yield* fileSystem.realPath(taskWorkspaceRoot);
      expect(first).toBe(path.join(canonicalTaskWorkspaceRoot, directoryName));
      expect(directoryName).toBe("整理本周销售周报_2026-08-11_14-47");
      expect(second).toBe(path.join(canonicalTaskWorkspaceRoot, `${directoryName}_2`));
      expect(yield* fileSystem.exists(first)).toBe(true);
      expect(yield* fileSystem.exists(second)).toBe(true);
    }),
  );

  it.effect("removes only empty task directories during bootstrap cleanup", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fd-task-cleanup-" });
      const emptyDirectory = path.join(tempRoot, "empty");
      const nonEmptyDirectory = path.join(tempRoot, "non-empty");
      yield* fileSystem.makeDirectory(emptyDirectory);
      yield* fileSystem.makeDirectory(nonEmptyDirectory);
      yield* fileSystem.writeFileString(path.join(nonEmptyDirectory, "report.md"), "retained");

      yield* removeEmptyTaskWorkspace(emptyDirectory);
      yield* removeEmptyTaskWorkspace(nonEmptyDirectory);

      expect(yield* fileSystem.exists(emptyDirectory)).toBe(false);
      expect(yield* fileSystem.exists(nonEmptyDirectory)).toBe(true);
    }),
  );
});
