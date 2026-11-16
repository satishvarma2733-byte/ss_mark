// Auth-session storage adapter backed by the platform secure store (Android Keystore / iOS Keychain via expo-secure-store).
// Secure-store values should stay under ~2 KB, and a Supabase session is usually larger, so values are split into
// chunks. Pure module (store injected) so it can be unit tested without a device.
export type SecureKeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 32;

// Secure-store keys may contain only alphanumerics, ".", "-" and "_".
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function createChunkedSecureStorage(store: SecureKeyValueStore) {
  async function removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const count = Number(await store.getItemAsync(`${base}.count`));
    await store.deleteItemAsync(`${base}.count`);
    if (Number.isInteger(count) && count > 0) {
      for (let i = 0; i < Math.min(count, MAX_CHUNKS); i += 1) await store.deleteItemAsync(`${base}.${i}`);
    }
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const base = safeKey(key);
      const count = Number(await store.getItemAsync(`${base}.count`));
      if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await store.getItemAsync(`${base}.${i}`);
        if (part === null) return null; // partial write or tampering: treat as signed out
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
      if (chunks.length === 0) chunks.push("");
      if (chunks.length > MAX_CHUNKS) throw new Error("Session is too large for secure storage");
      const base = safeKey(key);
      await removeItem(key); // readers see "no session" until the new value is complete
      for (const [i, chunk] of chunks.entries()) await store.setItemAsync(`${base}.${i}`, chunk);
      await store.setItemAsync(`${base}.count`, String(chunks.length));
    },
    removeItem
  };
}
