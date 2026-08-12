export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "assets/fd/fangde-ai-1024.png",
  productionLinuxIconPng: "assets/fd/fangde-ai-1024.png",
  productionWindowsIconIco: "assets/fd/fangde-ai.ico",
  productionWebFaviconIco: "assets/fd/fangde-ai.ico",
  productionWebFavicon16Png: "assets/fd/fangde-ai-16.png",
  productionWebFavicon32Png: "assets/fd/fangde-ai-32.png",
  productionWebAppleTouchIconPng: "assets/fd/fangde-ai-180.png",

  nightlyMacIconPng: "assets/fd/fangde-ai-1024.png",
  nightlyLinuxIconPng: "assets/fd/fangde-ai-1024.png",
  nightlyWindowsIconIco: "assets/fd/fangde-ai.ico",
  nightlyWebFaviconIco: "assets/fd/fangde-ai.ico",
  nightlyWebFavicon16Png: "assets/fd/fangde-ai-16.png",
  nightlyWebFavicon32Png: "assets/fd/fangde-ai-32.png",
  nightlyWebAppleTouchIconPng: "assets/fd/fangde-ai-180.png",

  developmentDesktopIconPng: "assets/fd/fangde-ai-1024.png",
  developmentWindowsIconIco: "assets/fd/fangde-ai.ico",
  developmentWebFaviconIco: "assets/fd/fangde-ai.ico",
  developmentWebFavicon16Png: "assets/fd/fangde-ai-16.png",
  developmentWebFavicon32Png: "assets/fd/fangde-ai-32.png",
  developmentWebAppleTouchIconPng: "assets/fd/fangde-ai-180.png",
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export function resolveWebAssetBrandForPackageVersion(version: string): WebAssetBrand {
  return version.includes("-nightly.") ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");

export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = resolveWebIconOverrides(
  "development",
  "apps/web/public",
);
