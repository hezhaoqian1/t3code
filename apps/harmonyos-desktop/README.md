# FD AI native HarmonyOS client

This application is a native ArkUI client. It does not load the T3 web renderer
or use ArkWeb for the main surface.

The client talks to the FD Runtime over authenticated HTTPS. Turn responses use
the versioned SSE contract today; the client also contains a sequence-aware
WebSocket replay adapter that stays dormant until the gateway advertises a
deployed replay endpoint. The default endpoint is the production gateway, but
debug builds can point at a staging runtime in
`entry/src/main/ets/config/HarmonyConfig.ets`.

Build with DevEco Studio or the bundled `hvigorw` wrapper:

```text
hvigorw assembleHap --mode module -p product=default
```

The current repository does not include a Harmony SDK in CI. Run the build on a
machine with DevEco Studio and the compatible HarmonyOS SDK installed.
