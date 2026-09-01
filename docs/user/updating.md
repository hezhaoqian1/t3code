# 更新方德 AI 桌面版

方德 AI 桌面版与本地 Agent 服务作为一个安装包更新。任务、设置和项目文件不会因更新被删除。

收到新版本提示后（macOS Apple Silicon 或 Windows x64）：

1. 等待正在运行的 Agent 和终端命令结束。
2. 在桌面端更新入口点击下载。
3. 下载完成后点击重启并安装。
4. 安装完成后应用会自动重新打开，确认账号、任务和空间正常显示。

macOS 内部包在安装前会校验版本、应用标识、Apple Silicon 架构和代码封装。应用安装在当前
账号可写的位置时会直接更新；安装目录需要更高权限时，macOS 会显示一次系统管理员授权框。
取消授权不会替换当前版本。

更新包来自 `https://ai-api.fdsure.com/downloads/desktop/latest`，并由桌面端校验
`electron-updater` 清单。当前内部试用包尚未完成 macOS Developer ID 签名、公证和
Windows Authenticode 签名，首次安装时系统仍可能显示 Gatekeeper 或 SmartScreen 提示。

如果应用内更新校验失败、管理员授权被取消或替换自动回滚，可从
[方德 AI 下载页](https://ai-api.fdsure.com/api-access)下载对应平台的最新安装包覆盖安装。
不要卸载应用，也不要手工删除方德 AI 的应用数据目录。
