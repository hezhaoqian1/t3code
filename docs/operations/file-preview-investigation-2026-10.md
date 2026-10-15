# 文件打不开排查（2026-10-15）

员工反馈所有生成文件打不开，截图实际是任务目录下的 `userdata/codex-home/skills/product-note-update/SKILL.md` 读取失败。没有原始回答和员工电脑目录，不能判定这个链接是模型写错、文件未生成还是已经移动；也不能从该截图推断全部文件服务故障。

## 已复现的问题

- 发布版 0.2.41 的 Markdown 协议过滤会清空 Windows 盘符链接；普通相对中文 Markdown、SVG、HTML 在同一隔离安装包中可读取。
- 相对路径含编码空格或 Windows 反斜杠时，链接识别失败。反斜杠被 Markdown 编码为 `%5C` 后，盘符识别仍需先解码。
- 渲染 `成果/入口.md` 时，其 `附录.md`、`./附录.md` 和图片原来相对于任务根目录解析，无法读取实际相邻文件。
- 实际调用 native FFF 索引：任务内存在的 PDF、DOCX、XLSX、PPTX 均不在文件列表结果中。索引正常返回，因此原有“索引失败时直接遍历”回退不会触发。
- Office 文件进入文本读取接口后被判定为二进制，原来只有通用英文错误，没有系统应用入口。原截图所示技能路径和普通文件缺失也共用该错误。

## 复用上游

- [#11527：按需浏览目录](https://github.com/pingdotgg/t3code/pull/11527)：移植 `directoryPath` 可选请求、直接读取目录与 `useDirectoryEntries`。保留原搜索接口，按需加载展开的文件夹，最多四个并发请求；没有引入上游移动端或远程架构。目录解析检查真实路径，禁止越界及 `.git`，不跟随目录链接。
- [#15628：显示实际读取位置](https://github.com/pingdotgg/t3code/pull/15628)：使用结构化 `ProjectReadFileError`，显示实际路径和任务目录，补充中文说明、重试与 Office 系统打开入口。
- [#16950：预览内链接基准目录](https://github.com/pingdotgg/t3code/pull/16950)：文件内显式链接按文件所在目录解析；行内代码的多段仓库路径仍相对任务根目录。沿用本 fork 的 Unicode 路径识别，补入上游对空格、编码盘符和 Windows home 分隔符的处理。

Office 系统打开必须由用户点击，仅对服务端确认存在且为二进制的办公扩展名显示。没有扩大任意文件读取权限，也没有自动打开可执行文件。

## 验证方法

使用独立 Electron 状态目录和生成的样本，分别启动真实 0.2.41 安装包与当前构建。数据库中的任务和消息均为隔离测试夹具；未写入员工现有任务。Office 测试验证原生 IPC 收到正确路径，并拦截系统启动，不代表已在 Office/WPS 内验证文档排版。

回归覆盖链接解码、完整 Markdown 渲染、目录读取、忽略文件、文件夹逐层加载、越界路径、Windows junction、缺失文件重试及格式分流。

macOS 专项覆盖 `/Users`、`/Volumes`、`~/`、`file:///`、中文和空格、`%23` 与 `%2520`、相邻文件及父目录。POSIX 路径比较保留大小写，Windows 才忽略大小写；目录预览的相对路径消除 `.`、`..`，避免同一文件出现无法选中的重复节点。系统打开通过 Electron `shell.openPath`，不拼接 Windows 命令。当前验证主机为 Windows，未将这些测试表述为 macOS 真机验收。

最终结果：6 个前端测试文件、94 项测试通过；`WorkspaceEntries` 34 项测试通过；web/server/contracts 包级类型检查、定向格式检查、桌面本地构建通过。定向 lint 无错误，`markdown-links.ts` 原有 glob 排除表达式有两条无用转义警告。

最终隔离 Electron 验收的 14 个场景均通过：普通 Markdown、Windows 绝对路径、中文空格、相对反斜杠、图片、HTML、PDF、三种 Office 格式、技能错误提示、嵌套报告、文件树成果文件和重新读取。PDF 除 HTTP 200、`application/pdf` 和文件头外，也确认内置阅读器显示一页内容。截图与运行结果保存在本机 `C:/fd019/qa-batch2/runs/file-matrix-current/`；PDF 内容截图另见 `file-preview-final-probe/pdf-later.png`。

另查未改动的 `WorkspaceFileSystem` 测试：8 项通过，1 项在此 Windows 主机创建文件 symlink 时因 EPERM 失败；没有跳过或放宽该检查。新增目录 junction 越界测试通过。

按用户要求，本次只合并并推送源码，不触发安装包构建或发布。验证时公开更新源仍为 0.2.41。
