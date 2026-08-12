export function isOfficeWorkspaceProject(input: {
  readonly isDesktop: boolean;
  readonly projectId: string | null | undefined;
  readonly projectEnvironmentId: string | null | undefined;
  readonly projectPurpose?: "workspace" | "task" | null | undefined;
  readonly bootstrapProjectId: string | null | undefined;
  readonly bootstrapEnvironmentId: string | null | undefined;
}): boolean {
  return (
    input.projectPurpose === "task" ||
    (input.isDesktop &&
      typeof input.projectId === "string" &&
      typeof input.projectEnvironmentId === "string" &&
      typeof input.bootstrapProjectId === "string" &&
      typeof input.bootstrapEnvironmentId === "string" &&
      input.projectId === input.bootstrapProjectId &&
      input.projectEnvironmentId === input.bootstrapEnvironmentId)
  );
}

export function isGeneratedTaskWorkspaceRoot(workspaceRoot: string | null | undefined): boolean {
  if (typeof workspaceRoot !== "string") return false;
  return workspaceRoot.replaceAll("\\", "/").includes("/FangdeAI/Tasks/");
}

export function isTaskAreaProject(input: {
  readonly isDesktop: boolean;
  readonly projectId: string | null | undefined;
  readonly projectEnvironmentId: string | null | undefined;
  readonly projectPurpose?: "workspace" | "task" | null | undefined;
  readonly workspaceRoot?: string | null | undefined;
  readonly bootstrapProjectId: string | null | undefined;
  readonly bootstrapEnvironmentId: string | null | undefined;
}): boolean {
  return isGeneratedTaskWorkspaceRoot(input.workspaceRoot) || isOfficeWorkspaceProject(input);
}

export function findOfficeWorkspaceProject<
  T extends { readonly id: string; readonly environmentId: string },
>(input: {
  readonly isDesktop: boolean;
  readonly projects: ReadonlyArray<T>;
  readonly bootstrapProjectId: string | null | undefined;
  readonly bootstrapEnvironmentId: string | null | undefined;
}): T | null {
  if (!input.isDesktop || !input.bootstrapProjectId || !input.bootstrapEnvironmentId) return null;
  return (
    input.projects.find(
      (project) =>
        project.id === input.bootstrapProjectId &&
        project.environmentId === input.bootstrapEnvironmentId,
    ) ?? null
  );
}

export function excludeOfficeWorkspaceProjects<
  T extends {
    readonly id: string;
    readonly environmentId: string;
    readonly projectPurpose?: "workspace" | "task" | undefined;
    readonly workspaceRoot?: string | undefined;
  },
>(input: {
  readonly isDesktop: boolean;
  readonly projects: ReadonlyArray<T>;
  readonly bootstrapProjectId: string | null | undefined;
  readonly bootstrapEnvironmentId: string | null | undefined;
}): T[] {
  return input.projects.filter(
    (project) =>
      !isTaskAreaProject({
        isDesktop: input.isDesktop,
        projectId: project.id,
        projectEnvironmentId: project.environmentId,
        projectPurpose: project.projectPurpose,
        workspaceRoot: project.workspaceRoot,
        bootstrapProjectId: input.bootstrapProjectId,
        bootstrapEnvironmentId: input.bootstrapEnvironmentId,
      }),
  );
}

export function isTechnicalWorkbenchCommand(command: string | null): boolean {
  if (command === null) return false;
  return (
    command === "filePicker.toggle" ||
    command === "projectSearch.toggle" ||
    command === "rightPanel.toggle" ||
    command === "diff.toggle" ||
    command.startsWith("terminal.") ||
    (command.startsWith("script.") && command.endsWith(".run"))
  );
}

export function shouldBlockOfficeTechnicalWorkbenchCommand(input: {
  readonly officeMode: boolean;
  readonly command: string | null;
}): boolean {
  return input.officeMode && isTechnicalWorkbenchCommand(input.command);
}

export function isOfficeWorkspaceShellContext(
  input: Parameters<typeof isOfficeWorkspaceProject>[0] & { readonly pathname: string },
): boolean {
  return (
    isOfficeWorkspaceProject(input) ||
    (input.isDesktop &&
      input.pathname === "/" &&
      typeof input.bootstrapProjectId === "string" &&
      typeof input.bootstrapEnvironmentId === "string")
  );
}

export function shouldExposeTechnicalWorkbenchEntryPoints(officeMode: boolean): boolean {
  return !officeMode;
}
