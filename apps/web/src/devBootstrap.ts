const VITE_DEVELOPMENT_BOOTSTRAP_ENV = "VITE_T3CODE_DEV_BOOTSTRAP_TOKEN";
const VITE_DEVELOPMENT_BOOTSTRAP_DEFINE = "import.meta.env.VITE_T3CODE_DEV_BOOTSTRAP_TOKEN";

export function prepareViteDevelopmentBootstrap(input: {
  readonly command: "build" | "serve";
  readonly enabled: boolean;
  readonly environment: Record<string, string | undefined>;
}): Record<string, string> {
  if (input.command === "build") {
    delete input.environment[VITE_DEVELOPMENT_BOOTSTRAP_ENV];
    return {};
  }

  const credential = input.enabled
    ? (input.environment[VITE_DEVELOPMENT_BOOTSTRAP_ENV]?.trim() ?? "")
    : "";
  return { [VITE_DEVELOPMENT_BOOTSTRAP_DEFINE]: JSON.stringify(credential) };
}
