import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

import {
  FdSession,
  FdSessionStorage,
  MemoryFdSessionStorage
} from '../data/FdModels';
import { getHarmonyAbilityContext } from './HarmonyContext';

const SESSION_STORE_NAME: string = 'fd-harmony-session';
const SESSION_KEY: string = 'session';

/**
 * Preferences is app-private on HarmonyOS. Only the short-lived access-token
 * projection is stored; passwords, refresh cookies and provider keys are not.
 */
export class HarmonySessionStorage implements FdSessionStorage {
  private readonly context: common.UIAbilityContext;
  private store: preferences.Preferences | undefined;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async load(): Promise<FdSession | undefined> {
    const prefs = await this.getStore();
    const value = await prefs.get(SESSION_KEY, '');
    if (typeof value !== 'string' || value.length === 0) return undefined;
    try {
      const parsed: Record<string, Object> = JSON.parse(value) as Record<string, Object>;
      const accessToken = typeof parsed['accessToken'] === 'string' ? parsed['accessToken'] : '';
      const userName = typeof parsed['userName'] === 'string' ? parsed['userName'] : '';
      const accessExpiresAt = typeof parsed['accessExpiresAt'] === 'number' ? parsed['accessExpiresAt'] : 0;
      const runtimeTokenId = typeof parsed['runtimeTokenId'] === 'number' ? parsed['runtimeTokenId'] : 0;
      if (accessToken.length === 0 || userName.length === 0) return undefined;
      return {
        accessToken,
        accessExpiresAt,
        userName,
        ...(runtimeTokenId > 0 ? { runtimeTokenId } : {})
      } as FdSession;
    } catch (_error) {
      await this.clear();
      return undefined;
    }
  }

  async save(session: FdSession): Promise<void> {
    const prefs = await this.getStore();
    await prefs.put(SESSION_KEY, JSON.stringify({
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt,
      userName: session.userName,
      ...(session.runtimeTokenId === undefined ? {} : { runtimeTokenId: session.runtimeTokenId })
    }));
    await prefs.flush();
  }

  async clear(): Promise<void> {
    const prefs = await this.getStore();
    await prefs.delete(SESSION_KEY);
    await prefs.flush();
  }

  private async getStore(): Promise<preferences.Preferences> {
    if (this.store !== undefined) return this.store;
    this.store = await preferences.getPreferences(this.context, { name: SESSION_STORE_NAME });
    return this.store;
  }
}

/** A deterministic fallback for static tests and context-less previews. */
export function createHarmonySessionStorage(): FdSessionStorage {
  const context = getHarmonyAbilityContext();
  return context === undefined ? new MemoryFdSessionStorage() : new HarmonySessionStorage(context);
}
