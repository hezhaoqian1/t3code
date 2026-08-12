import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { buildProjectGroups, type ProjectGroupingSettings } from "./logicalProject";
import type { Project } from "./types";

export interface SidebarProjectGroupMember extends Project {
  physicalProjectKey: string;
}

export interface SidebarProjectSnapshot extends Project {
  projectKey: string;
  displayName: string;
  groupedProjectCount: number;
  memberProjects: readonly SidebarProjectGroupMember[];
  memberProjectRefs: readonly ScopedProjectRef[];
}

export interface SidebarProjectPickerEntry {
  group: SidebarProjectSnapshot;
  targetProject: SidebarProjectGroupMember;
  isPreferred: boolean;
}

export function buildPhysicalToLogicalProjectKeyMap(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
}): Map<string, string> {
  const mapping = new Map<string, string>();
  const projects =
    input.primaryEnvironmentId === null
      ? []
      : input.projects.filter((project) => project.environmentId === input.primaryEnvironmentId);
  const groups = buildProjectGroups({
    projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  });
  for (const group of groups) {
    for (const member of group.members) {
      mapping.set(member.physicalProjectKey, group.key);
    }
  }
  return mapping;
}

export function buildSidebarProjectSnapshots(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
}): SidebarProjectSnapshot[] {
  const projects =
    input.primaryEnvironmentId === null
      ? []
      : input.projects.filter((project) => project.environmentId === input.primaryEnvironmentId);
  return buildProjectGroups({
    projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  }).map((group): SidebarProjectSnapshot => {
    const members = group.members.map(
      ({ physicalProjectKey, project }): SidebarProjectGroupMember => ({
        ...project,
        physicalProjectKey,
      }),
    );
    const representative =
      members.find(
        (member) =>
          member.environmentId === group.representative.environmentId &&
          member.id === group.representative.id,
      ) ?? members[0]!;

    return {
      ...representative,
      projectKey: group.key,
      displayName: group.label,
      groupedProjectCount: members.length,
      memberProjects: members,
      memberProjectRefs: group.memberProjectRefs,
    };
  });
}

export function buildSidebarProjectPickerEntries(input: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  preferredProjectRef: ScopedProjectRef | null;
}) {
  const entries = input.groups.flatMap((group): SidebarProjectPickerEntry[] => {
    const isPreferred = input.preferredProjectRef
      ? group.memberProjectRefs.some(
          (projectRef) =>
            projectRef.environmentId === input.preferredProjectRef?.environmentId &&
            projectRef.projectId === input.preferredProjectRef.projectId,
        )
      : false;
    const preferredProject = isPreferred
      ? (group.memberProjects.find(
          (project) =>
            project.environmentId === input.preferredProjectRef?.environmentId &&
            project.id === input.preferredProjectRef?.projectId,
        ) ??
        group.memberProjects.find(
          (project) => project.environmentId === input.preferredProjectRef?.environmentId,
        ))
      : null;
    const targetProject =
      preferredProject ??
      group.memberProjects.find(
        (project) => project.environmentId === group.environmentId && project.id === group.id,
      ) ??
      group.memberProjects[0];
    if (!targetProject) return [];

    return [{ group, targetProject, isPreferred }];
  });
  const preferredIndex = entries.findIndex((entry) => entry.isPreferred);
  if (preferredIndex <= 0) return entries;

  return [
    entries[preferredIndex]!,
    ...entries.slice(0, preferredIndex),
    ...entries.slice(preferredIndex + 1),
  ];
}
