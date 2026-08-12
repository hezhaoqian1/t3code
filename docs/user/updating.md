# 更新方德 AI 桌面版

方德 AI 桌面版与本地 Agent 服务作为一个安装包更新。任务、设置和项目文件不会因更新被删除。

收到新版本提示后：

1. 等待正在运行的 Agent 和终端命令结束。
2. 在桌面端更新入口点击下载。
3. 下载完成后点击重启并安装。
4. 应用重新打开后，确认账号、任务和空间正常显示。

更新包来自 `https://ai-api.fdsure.com/downloads/desktop/latest`，并由桌面端校验
`electron-updater` 清单。macOS 正式包经过 Developer ID 签名和公证，Windows 正式包经过
Authenticode 签名。

如果应用内更新失败，可从[方德 AI 下载页](https://ai-api.fdsure.com/api-access)下载对应平台的
最新安装包覆盖安装。不要卸载或手工删除 `~/FangdeAI`。
