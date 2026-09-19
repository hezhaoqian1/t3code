import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0xFDF0;

export default class EntryAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, 'FangdeAI', 'Native HarmonyOS client started');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) {
        hilog.error(DOMAIN, 'FangdeAI', 'Failed to load main page: %{public}s', JSON.stringify(error));
      }
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, 'FangdeAI', 'Native HarmonyOS window destroyed');
  }
}

