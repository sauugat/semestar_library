/**
 * Semester Library Games Platform - Local Ludo Storage Abstraction
 *
 * Provides a clean boundary for offline match persistence.
 * Ships with:
 * - AsyncStorage adapter for React Native / Expo production
 * - InMemory adapter for deterministic tests and headless runs
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalLudoSavedEnvelope } from '../../types/ludo-session.ts';

export const LUDO_OFFLINE_STORAGE_KEY = '@semester_library/ludo_offline_session_v1';

export interface LocalLudoStorage {
  load(): Promise<LocalLudoSavedEnvelope | null>;
  save(envelope: LocalLudoSavedEnvelope): Promise<void>;
  remove(): Promise<void>;
}

/**
 * In-memory storage adapter for deterministic tests and mock runs.
 */
export class InMemoryLudoStorageAdapter implements LocalLudoStorage {
  private saved: string | null = null;
  public failNextSave: boolean = false;

  public async load(): Promise<LocalLudoSavedEnvelope | null> {
    if (!this.saved) {
      return null;
    }
    return JSON.parse(this.saved) as LocalLudoSavedEnvelope;
  }

  public async save(envelope: LocalLudoSavedEnvelope): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('Simulated storage save failure');
    }
    this.saved = JSON.stringify(envelope);
  }

  public async remove(): Promise<void> {
    this.saved = null;
  }

  /**
   * Helper for tests to inject raw corrupt data
   */
  public setRawData(raw: string | null): void {
    this.saved = raw;
  }
}

/**
 * Production storage adapter backed by @react-native-async-storage/async-storage.
 */
export class AsyncStorageLudoStorageAdapter implements LocalLudoStorage {
  private readonly storageKey: string;

  constructor(storageKey: string = LUDO_OFFLINE_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  public async load(): Promise<LocalLudoSavedEnvelope | null> {
    const raw = await AsyncStorage.getItem(this.storageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as LocalLudoSavedEnvelope;
  }

  public async save(envelope: LocalLudoSavedEnvelope): Promise<void> {
    const serialized = JSON.stringify(envelope);
    await AsyncStorage.setItem(this.storageKey, serialized);
  }

  public async remove(): Promise<void> {
    await AsyncStorage.removeItem(this.storageKey);
  }
}
