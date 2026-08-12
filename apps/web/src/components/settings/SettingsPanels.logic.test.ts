import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import { getBackgroundActivityPresetSettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundActivitySharedPolicySettings,
  formatDiagnosticsDescription,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  resolveBackgroundActivityProfileOption,
} from "./SettingsPanels.logic";

describe("background activity settings restore", () => {
  it("detects legacy interval values even when the structured setting is at its default", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      }),
    ).toBe(true);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe(true);
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
  });

  it("detects a legacy profile override so restoring defaults clears it", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        ...DEFAULT_UNIFIED_SETTINGS,
        backgroundActivityProfile: "performance",
      }),
    ).toBe(true);
  });

  it("shows the effective legacy preset and marks custom legacy intervals as advanced", () => {
    const performance = getBackgroundActivityPresetSettings("performance");
    expect(
      resolveBackgroundActivityProfileOption({
        ...DEFAULT_UNIFIED_SETTINGS,
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: "performance",
        automaticGitFetchInterval: performance.automaticGitFetchInterval,
        providerHealthRefreshInterval: performance.providerHealthRefreshInterval,
      }),
    ).toBe("performance");

    expect(
      resolveBackgroundActivityProfileOption({
        ...DEFAULT_UNIFIED_SETTINGS,
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: "performance",
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe("advanced");
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });

  it("materializes legacy advanced overrides before changing the shared policy", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          automaticGitFetchInterval,
        },
        "battery-saver",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval,
      },
    });
  });
});

describe("project grouping toggle", () => {
  it("enables repository grouping and disables into separate projects", () => {
    expect(isProjectGroupingEnabled("repository")).toBe(true);
    expect(isProjectGroupingEnabled("repository_path")).toBe(true);
    expect(isProjectGroupingEnabled("separate")).toBe(false);
    expect(projectGroupingModeFromToggle(true)).toBe("repository");
    expect(projectGroupingModeFromToggle(false)).toBe("separate");
  });

  it("restores repository path grouping when the toggle is cycled", () => {
    expect(projectGroupingModeFromToggle(false, "repository_path")).toBe("separate");
    expect(projectGroupingModeFromToggle(true, "repository_path")).toBe("repository_path");
  });
});

describe("formatDiagnosticsDescription", () => {
  it("collapses trace and metric URLs that share the same OTEL base path", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      }),
    ).toBe("Local trace file. Exporting OTEL to http://localhost:4318/v1/{traces,metrics}.");
  });

  it("keeps separate trace and metric URLs when their base paths differ", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:9000/v1/metrics",
      }),
    ).toBe(
      "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces and metrics to http://localhost:9000/v1/metrics.",
    );
  });

  it("omits OTEL text when no exporter is enabled", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      }),
    ).toBe("Local trace file.");
  });
});
