# 更新方德 AI 桌面版

方德 AI 桌面版与本地 Agent 服务作为一个安装包更新。任务、设置和项目文件不会因更新被删除。

当前内部通道版本为 `0.2.11`。收到新版本提示后（Windows x64）：

1. 等待正在运行的 Agent 和终端命令结束。
2. 在桌面端更新入口点击下载。
3. 下载完成后点击重启并安装。
4. 安装完成后应用会自动重新打开，确认账号、任务和空间正常显示。

macOS Apple Silicon 的内部未签名包不走应用内自动安装。请从下载页获取新的 DMG，退出方德
AI 后将新应用拖到“应用程序”中覆盖旧版本，再重新打开；任务目录、设置和本地项目不会被
删除。

更新包来自 `https://ai-api.fdsure.com/downloads/desktop/latest`，并由桌面端校验
`electron-updater` 清单。当前内部试用包尚未完成 macOS Developer ID 签名、公证和
Windows Authenticode 签名，系统可能显示 Gatekeeper 或 SmartScreen 提示；正式生产通道
启用前必须完成两端签名和真机升级验收。

如果应用内更新失败，可从[方德 AI 下载页](https://ai-api.fdsure.com/api-access)下载对应平台的
最新安装包覆盖安装。不要卸载或手工删除 `~/FangdeAI`。
