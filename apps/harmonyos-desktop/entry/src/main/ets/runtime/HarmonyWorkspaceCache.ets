import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

import {
  FdWorkspaceCache,
  FdWorkspaceSnapshot,
  MemoryFdWorkspaceCache,
  sanitizeWorkspaceSnapshot
} from '../data/FdModels';
import { getHarmonyAbilityContext } from './HarmonyContext';

const WORKSPACE_STORE_NAME: string = 'fd-harmony-workspace';
const WORKSPACE_KEY: string = 'snapshot';
const MAX_STORED_CHARS: number = 800000;

type JsonObject = Record<string, Object>;

/**
 * Stores only the visible workspace projection. Credentials and provider
 * configuration remain owned by the runtime session layer.
 */
export class HarmonyWorkspaceCache implements FdWorkspaceCache {
  private readonly context: common.UIAbilityContext;
  private store: preferences.Preferences | undefined;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async load(accountName: string): Promise<FdWorkspaceSnapshot | undefined> {
    const prefs = await this.getStore();
    const value = await prefs.get(WORKSPACE_KEY, '');
    if (typeof value !== 'string' || value.length === 0) return undefined;
    if (value.length > MAX_STORED_CHARS) {
      await this.clear();
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as JsonObject;
      if (!isSnapshotShape(parsed) || parsed['accountName'] !== accountName) return undefined;
      return sanitizeWorkspaceSnapshot(parsed as FdWorkspaceSnapshot);
    } catch (_error) {
      await this.clear();
      return undefined;
    }
  }

  async save(snapshot: FdWorkspaceSnapshot): Promise<void> {
    const prefs = await this.getStore();
    const safe = sanitizeWorkspaceSnapshot(snapshot);
    const encoded = JSON.stringify(safe);
    if (encoded.length > MAX_STORED_CHARS) return;
    await prefs.put(WORKSPACE_KEY, encoded);
    await prefs.flush();
  }

  async clear(): Promise<void> {
    const prefs = await this.getStore();
    await prefs.delete(WORKSPACE_KEY);
    await prefs.flush();
  }

  private async getStore(): Promise<preferences.Preferences> {
    if (this.store !== undefined) return this.store;
    this.store = await preferences.getPreferences(this.context, { name: WORKSPACE_STORE_NAME });
    return this.store;
  }
}

function isSnapshotShape(value: JsonObject): boolean {
  const activeThread = value['activeThread'];
  return typeof value['accountName'] === 'string' &&
    Array.isArray(value['threads']) &&
    typeof activeThread === 'object' && activeThread !== null && !Array.isArray(activeThread) &&
    Array.isArray((activeThread as JsonObject)['messages']) &&
    Array.isArray((activeThread as JsonObject)['activities']) &&
    Array.isArray((activeThread as JsonObject)['attachments']) &&
    Array.isArray(value['queuedTurns']);
}

/** A deterministic fallback for previews, tests, and context-less tooling. */
export function createHarmonyWorkspaceCache(): FdWorkspaceCache {
  const context = getHarmonyAbilityContext();
  return context === undefined ? new MemoryFdWorkspaceCache() : new HarmonyWorkspaceCache(context);
}
