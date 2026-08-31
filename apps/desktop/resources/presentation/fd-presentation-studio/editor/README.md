# 方德演示本地编辑器（完全离线 · 无 iframe）

基于固定版本的本地演示编辑器镜像，单页运行：

- 无 iframe、无云端同步 / 分享 / 云盘 / 外部 AI
- 本地打开 PPTD 文件夹并自动保存
- 官方编辑器内「导出」走本地 patched WASM

## 启动

```bash
cd editor
由方德 AI Desktop 宿主加载，无需员工安装或启动本地服务。
```

由方德 AI Desktop 直接打开，员工不需要访问本地端口。

## 使用

1. **打开演示文稿项目**（桌面宿主提供读写权限）
2. 在官方编辑器 UI 中编辑
3. 顶栏 **导出** → 下载 PPTX / 图片（无分享、无 Google 云盘）

## 结构

```
editor/
  index.html          # 唯一入口（官方 UI + 本地顶栏）
  local-bridge.js     # 取代 Penpal 父页面的本地桥
  local-shell.css
  neo-ppt/            # 官方前端镜像
    assets/
      pptd_wasm_bg-DPPWdROu.wasm   # 唯一一份 patched PPTX WASM（真源）
      index_bg-*.wasm              # resvg（渲染用，勿与上者混淆）
```

Agent 侧 `scripts/local-export/` 在 skill install 时会从上述真源拷贝一份 `pptd_wasm_bg.wasm`；仓库内导出脚本直接引用本路径。
