import * as Schema from "effect/Schema";

export type FdExecutionProfile = "local" | `enterprise:${number}`;

const ResumeCursor = Schema.Struct({ threadId: Schema.String });
const Binding = Schema.Struct({
  version: Schema.Literal(1),
  activeProfile: Schema.String,
  profiles: Schema.Record(Schema.String, ResumeCursor),
});
const isCursor = Schema.is(ResumeCursor);
const isBinding = Schema.is(Binding);
const isProfile = (profile: string): profile is FdExecutionProfile =>
  profile === "local" || /^enterprise:[1-9][0-9]*$/.test(profile);

export function restoreFdContextBinding(cursor: unknown): {
  activeProfile: FdExecutionProfile | undefined;
  profiles: Map<FdExecutionProfile, { readonly threadId: string }>;
} {
  const profiles = new Map<FdExecutionProfile, { readonly threadId: string }>();
  if (!isCursor(cursor) || !cursor.threadId.trim()) return { activeProfile: undefined, profiles };
  const binding = "fdContext" in cursor ? cursor.fdContext : undefined;
  if (
    "fdContext" in cursor &&
    (!isBinding(binding) ||
      !isProfile(binding.activeProfile) ||
      !binding.profiles[binding.activeProfile]?.threadId.trim() ||
      binding.profiles[binding.activeProfile]?.threadId !== cursor.threadId ||
      Object.entries(binding.profiles).some(
        ([profile, value]) => !isProfile(profile) || !value.threadId.trim(),
      ))
  ) {
    // Unusable history starts fresh without assigning a Skill's context to another profile.
    return { activeProfile: undefined, profiles };
  }
  if (isBinding(binding) && isProfile(binding.activeProfile)) {
    for (const [profile, value] of Object.entries(binding.profiles)) {
      if (isProfile(profile) && value.threadId.trim()) profiles.set(profile, value);
    }
    return { activeProfile: binding.activeProfile, profiles };
  }
  // Legacy cursors have no Skill provenance; only the local profile can reuse them.
  profiles.set("local", { threadId: cursor.threadId });
  return { activeProfile: "local", profiles };
}

export function encodeFdContextBinding(
  activeProfile: FdExecutionProfile,
  profiles: ReadonlyMap<FdExecutionProfile, unknown>,
) {
  const active = profiles.get(activeProfile);
  if (!isCursor(active)) return undefined;
  return {
    threadId: active.threadId,
    fdContext: {
      version: 1 as const,
      activeProfile,
      profiles: Object.fromEntries(
        [...profiles].flatMap(([profile, value]) =>
          isCursor(value) ? [[profile, { threadId: value.threadId }]] : [],
        ),
      ),
    },
  };
}
