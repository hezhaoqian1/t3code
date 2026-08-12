import { describe, expect, it } from "vite-plus/test";

import {
  excludeOfficeWorkspaceProjects,
  findOfficeWorkspaceProject,
  isOfficeWorkspaceProject,
  isOfficeWorkspaceShellContext,
  isGeneratedTaskWorkspaceRoot,
  isTaskAreaProject,
  isTechnicalWorkbenchCommand,
  shouldBlockOfficeTechnicalWorkbenchCommand,
  shouldExposeTechnicalWorkbenchEntryPoints,
} from "./officeMode";

describe("officeMode", () => {
  const projects = [
    {
      id: "office",
      environmentId: "desktop",
      workspaceRoot: "/app/userdata/office-workspace",
    },
    {
      id: "employee",
      environmentId: "desktop",
      workspaceRoot: "/Users/employee/reports",
    },
  ];

  it("identifies only the trusted desktop bootstrap project", () => {
    expect(
      isOfficeWorkspaceProject({
        isDesktop: true,
        projectId: "office",
        projectEnvironmentId: "desktop",
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toBe(true);
    expect(
      isOfficeWorkspaceProject({
        isDesktop: true,
        projectId: "employee",
        projectEnvironmentId: "desktop",
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toBe(false);
    expect(
      isOfficeWorkspaceProject({
        isDesktop: false,
        projectId: "office",
        projectEnvironmentId: "desktop",
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toBe(false);
  });

  it("does not infer office identity from a matching raw workspace path", () => {
    expect(
      isOfficeWorkspaceProject({
        isDesktop: true,
        projectId: "employee",
        projectEnvironmentId: "desktop",
        bootstrapProjectId: undefined,
        bootstrapEnvironmentId: "desktop",
      }),
    ).toBe(false);
  });

  it("treats typed task projects as task mode without relying on desktop bootstrap identity", () => {
    expect(
      isOfficeWorkspaceProject({
        isDesktop: false,
        projectId: "task-project",
        projectEnvironmentId: "local",
        projectPurpose: "task",
        bootstrapProjectId: undefined,
        bootstrapEnvironmentId: undefined,
      }),
    ).toBe(true);
  });

  it("recognizes legacy generated task directories without treating normal spaces as tasks", () => {
    expect(isGeneratedTaskWorkspaceRoot("/Users/employee/FangdeAI/Tasks/2026-08-11-14-47-46")).toBe(
      true,
    );
    expect(isGeneratedTaskWorkspaceRoot("C:\\Users\\employee\\FangdeAI\\Tasks\\2026-08-11")).toBe(
      true,
    );
    expect(isGeneratedTaskWorkspaceRoot("/Users/employee/projects/customer-portal")).toBe(false);
    expect(
      isTaskAreaProject({
        isDesktop: true,
        projectId: "legacy-task",
        projectEnvironmentId: "desktop",
        projectPurpose: "workspace",
        workspaceRoot: "/Users/employee/FangdeAI/Tasks/2026-08-11-14-47-46",
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toBe(true);
  });

  it("selects and excludes the owned workspace by welcome identity", () => {
    expect(
      findOfficeWorkspaceProject({
        isDesktop: true,
        projects: [...projects].reverse(),
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toEqual(projects[0]);
    expect(
      excludeOfficeWorkspaceProjects({
        isDesktop: true,
        projects,
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toEqual([projects[1]]);
  });

  it("keeps task projects out of workspace pickers", () => {
    const taskProject = {
      id: "task-project",
      environmentId: "desktop",
      workspaceRoot: "/Users/employee/FangdeAI/Tasks/2026-08-11-14-47-46",
      projectPurpose: "task" as const,
    };

    expect(
      excludeOfficeWorkspaceProjects({
        isDesktop: true,
        projects: [...projects, taskProject],
        bootstrapProjectId: "office",
        bootstrapEnvironmentId: "desktop",
      }),
    ).toEqual([projects[1]]);
  });

  it("keeps technical workbench entry points closed for office threads and office startup", () => {
    const identity = {
      isDesktop: true,
      bootstrapProjectId: "office",
      bootstrapEnvironmentId: "desktop",
    } as const;

    expect(
      isOfficeWorkspaceShellContext({
        ...identity,
        pathname: "/thread",
        projectId: "office",
        projectEnvironmentId: "desktop",
      }),
    ).toBe(true);
    expect(
      isOfficeWorkspaceShellContext({
        ...identity,
        pathname: "/thread",
        projectId: "employee",
        projectEnvironmentId: "desktop",
      }),
    ).toBe(false);
    expect(
      isOfficeWorkspaceShellContext({
        ...identity,
        pathname: "/",
        projectId: undefined,
        projectEnvironmentId: undefined,
      }),
    ).toBe(true);
    expect(shouldExposeTechnicalWorkbenchEntryPoints(true)).toBe(false);
    expect(shouldExposeTechnicalWorkbenchEntryPoints(false)).toBe(true);
  });

  it("blocks technical workbench commands only while office mode is active", () => {
    for (const command of [
      "filePicker.toggle",
      "projectSearch.toggle",
      "rightPanel.toggle",
      "diff.toggle",
      "terminal.toggle",
      "terminal.new",
      "terminal.split",
      "terminal.splitVertical",
      "terminal.close",
      "script.test.run",
    ]) {
      expect(isTechnicalWorkbenchCommand(command)).toBe(true);
      expect(shouldBlockOfficeTechnicalWorkbenchCommand({ officeMode: true, command })).toBe(true);
      expect(shouldBlockOfficeTechnicalWorkbenchCommand({ officeMode: false, command })).toBe(
        false,
      );
    }
    expect(isTechnicalWorkbenchCommand("chat.new")).toBe(false);
    expect(
      shouldBlockOfficeTechnicalWorkbenchCommand({ officeMode: true, command: "chat.new" }),
    ).toBe(false);
  });
});
