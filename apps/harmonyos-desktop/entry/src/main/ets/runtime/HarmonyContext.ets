import { common } from '@kit.AbilityKit';

let abilityContext: common.UIAbilityContext | undefined;

/** Set once by EntryAbility before the ArkUI page is created. */
export function setHarmonyAbilityContext(context: common.UIAbilityContext): void {
  abilityContext = context;
}

export function getHarmonyAbilityContext(): common.UIAbilityContext | undefined {
  return abilityContext;
}
