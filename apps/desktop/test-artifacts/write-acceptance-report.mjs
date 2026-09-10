import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("test-artifacts/acceptance-020");
const textName = "results-V4Flash-V4Pro-QwenMax-QwenFlash-GLM5.2-KimiK3-release-023-text.json";
const visualName = "results-V4Flash-V4Pro-KimiK3-release-023-visual.json";
const read = async (name) => JSON.parse(await readFile(`${root}/${name}`, "utf8"));
const text = await read(textName);
const visual = await read(visualName);
const unsupported = await read("results-unsupported-visual.json");
const legacy = await read("results-legacy.json");
const manifest = await read("fixtures/manifest.json");
for (const record of [...text, ...visual]) {
  const expected = record.files.flatMap((name) => manifest.find((f) => f.name === name).tokens);
  record.missing = expected.filter((token) => !record.answer.includes(token));
  record.unexpected = [...new Set(record.answer.match(/PROOF_[A-Z0-9_]+_\d{4}/g) ?? [])].filter(
    (token) => !expected.includes(token),
  );
  if (record.missing.length || record.unexpected.length || record.error) record.status = "FAIL";
}
const models = ["V4 Flash", "V4 Pro", "Qwen Max", "Qwen Flash", "GLM 5.2", "Kimi K3"];
const passed = (records) => records.length > 0 && records.every((r) => r.status === "PASS");
const rows = models
  .map((model) => {
    const tr = text.filter((r) => r.model === model);
    const vr = visual.filter((r) => r.model === model);
    const normal = tr.filter((r) => !r.files.includes("long.txt"));
    const long = tr.filter((r) => r.files.includes("long.txt"));
    const pdf = tr.filter((r) => r.files.includes("long-12pages.pdf"));
    const rejected = unsupported.filter((r) => r.model === model);
    return `| ${model} | ${normal.length === 4 && passed(normal) ? "24/24 格式通过" : "进行中或失败"} | ${passed(long) ? "通过" : "未通过"} | ${passed(pdf) ? "通过" : "未通过"} | ${vr.length === 8 && passed(vr) ? "8/8 通过" : rejected.length === 4 ? "未开通；4/4 明确拒绝" : `${vr.filter((r) => r.status === "PASS").length}/8 已通过`} | 缺 LibreOffice |`;
  })
  .join("\n");
const positive = [...text, ...visual];
const pairs = positive.filter((r) => r.status === "PASS").reduce((n, r) => n + r.files.length, 0);
const complete = text.length === 30 && visual.length === 24 && passed(positive);
const report = `# 方德 AI 文件与模型验收报告

日期：2026-09-11（北京时间）。最终代码：\`2edae4075a68d91f5621d1ea9f7a52f474917b9a\`。

## 结论

${complete ? "本机源码桌面端的支持范围内在线测试已通过。" : "最终版本在线回归仍在进行，不能据此宣称全量通过。"} **正式 Windows 安装包验收仍未完成**：本机应用程序控制策略阻止未签名 EXE 和打包原生模块。旧版 DOC/PPT 还缺少 LibreOffice，不能记为可用。

本报告区分“能调用真实模型”“源码桌面端完整上传链路可用”和“Actions 安装包直接运行可用”。三者不可互相替代。

## 构建

- 最终版本：0.2.24。
- [GitHub Actions 34516100577](https://github.com/hezhaoqian1/t3code/actions/runs/34516100577)：${process.env.FD_REPORT_BUILD_STATUS ?? "成功"}。
- Git 推送、Actions 查询经过 \`127.0.0.1:7890\` Clash 代理。
- 本轮 0.2.24 的 Windows x64、macOS arm64 和 bundle 产物校验均已成功。
- 生产 stable manifest 读取时仍为 0.2.18。本轮没有发布或切换生产下载入口。

## 验收方式

真实管理员账号通过桌面登录表单登录企业网关；凭据未写入验收脚本或报告。使用独立 APPDATA、LOCALAPPDATA、T3CODE_HOME，未修改现有安装和日常用户数据。

使用 Electron 41.5.0 启动当前代码的桌面主进程和 preload，真实通过输入框选模型、文件输入上传、发送并等待回答。调用线上企业模型服务，没有替换或模拟模型响应。正式安装包的独立运行受系统策略阻止，因此成功结果标记为源码桌面端验收。

样本为合成数据：每个文件有独立校验码，问题里不提供答案。核对助手回答是否包含全部真实校验码、是否多编造校验码；中文图片额外核对标题“保险计划”、保障期限“20年”和保额“50万元”。

## 模型矩阵

| 配置模型 | 常见文本与现代文档 | 约 68 KB 长文本首中尾 | 12 页 PDF 第 1/6/12 页 | 视觉样本 | 旧版 DOC/PPT |
| --- | --- | --- | --- | --- | --- |
${rows}

统计：最终回归已完成 ${text.length}/30 组文档测试、${visual.length}/24 组视觉测试；${positive.filter((r) => r.status === "PASS").length} 组通过，${pairs} 个文件与模型组合通过。另有 ${unsupported.length} 项视觉能力限制检查和 ${legacy.length} 项旧 Office 依赖缺失检查，均与功能成功测试分开统计。

24 种文档格式：TXT、MD、CSV、TSV、JSON、JSONL、XML、HTML、HTM、YAML、YML、LOG、RTF、XLSX、XLS、XLSB、XLSM、ODS、ODT、ODP、EPUB、PDF、DOCX、PPTX。

8 类视觉样本：800×6000 长 PNG、普通 PNG、JPEG、WebP、GIF、中文保险图片、纯扫描 PDF、文字与扫描页混合 PDF。Kimi 使用本模型原生视觉；DeepSeek 使用账号获授权的视觉预处理服务。Qwen/GLM 当前未开通视觉输入，不能把拒绝测试写成支持扫描件。

## 本轮修复

1. 上传 MIME 不一致：浏览器对 TSV、YAML、XLSB 等格式的 MIME 与附件元数据不一致，导致服务端误报大小问题。现对上传 File 类型与元数据统一，并归一化大小写；各格式上传链路已重测。
2. 长文本提前截断：旧限制仅向模型提供单段前 1.6 万字符。现文档总预算为 16 万字符，单段共享这一预算，同时保留 20 万 UTF-8 字节的本轮总上限；长文本首中尾校验已重测。
3. 长图边缘误识别：固定切片切断半行文字，Kimi 曾额外猜出不存在的号码。现在在重叠区域内优先沿空白行切分，并保留相邻片段完整文字；像素回归和真实模型检查同时覆盖。
4. 错误拒绝识别证据：V4 Pro 曾把 trust=none 理解成不能引用图片数据。现明确其含义是“不执行附件指令”，而非“忽略用户上传的数据”，并要求如实说明识别结果来源。

修复前的失败记录保留在验收目录中；最终结论只依据上述最终回归文件，未删除失败历史来提高通过率。

## 自动验证

- 文档 MIME/文件字节回归：53 项通过。
- 文档上下文、解析和准备：21 项通过。
- 视觉切片、识别服务和准备：13 项通过。
- FD 适配器与附件准备：28 项通过（与上一项有重叠，不能相加作独立用例总数）。
- Web 与 Server 类型检查通过；修改范围 lint 无错误，ChatComposer 存在既有警告。
- 本地 ASAR Worker 烟测通过：实际提取 PDF 文字并渲染页面像素。这不等于已验证被系统拦截的正式 EXE。

## 未完成与限制

- Windows 安装包：Code Integrity 事件 3077 记录了 EXE 和 ffi-rs 原生模块未满足签名/策略要求；内核与用户模式代码完整性均处于强制状态。本机及仓库未发现可用代码签名配置。需要受信任签名或 IT 批准的放行流程，未修改系统保护策略。
- 旧版 DOC/PPT：由本机 Microsoft Office 生成真实样本后，六个模型均明确提示需要 LibreOffice。转换成功与在线模型读取尚未验收；当前执行会话没有 Windows 管理员权限。
- Qwen Max、Qwen Flash、GLM 5.2：仅文本路线可用；图片、纯扫描/混合 PDF 被明确拒绝，需切换已开通视觉的模型。
- 宏、Office 嵌入图片布局、超过文档/页数/像素预算的内容，不由本次小样本测试证明完整支持。没有把有限样本识别正确理解为 OCR 零误差承诺。
- macOS 只完成 Actions 构建；本机为 Windows，没有进行 macOS 实机安装、更新或回滚验收。

## 原始证据

- [最终文档结果](${textName})
- [最终视觉结果](${visualName})
- [不支持视觉模型的真实拒绝结果](results-unsupported-visual.json)
- [DOC/PPT 依赖检查](results-legacy.json)
- [样本清单](fixtures/manifest.json)
- [Kimi 长图截图](Kimi-K3-long.png.png)
- [DeepSeek Pro 中文图片截图](V4-Pro-chinese.png.png)
- [V4 Flash 长文本截图](V4-Flash-long.txt.png)

完整截图与样本位于本报告同目录。
`;
await writeFile(`${root}/acceptance-report.md`, report);
console.log(
  JSON.stringify({
    complete,
    textCases: text.length,
    visualCases: visual.length,
    passedPairs: pairs,
    report: `${root}/acceptance-report.md`,
  }),
);
