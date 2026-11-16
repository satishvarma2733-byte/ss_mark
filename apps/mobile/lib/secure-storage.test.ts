import { describe, expect, it } from "vitest";
import { createChunkedSecureStorage, type SecureKeyValueStore } from "./secure-storage";

function memoryStore() {
  const data = new Map<string, string>();
  const store: SecureKeyValueStore = {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`invalid key ${key}`);
      if (value.length > 2048) throw new Error("value too large");
      data.set(key, value);
    },
    deleteItemAsync: async (key) => {
      data.delete(key);
    }
  };
  return { store, data };
}

describe("chunked secure session storage", () => {
  it("round-trips a session larger than one secure-store value, using only valid keys", async () => {
    const { store, data } = memoryStore();
    const storage = createChunkedSecureStorage(store);
    const session = JSON.stringify({ access_token: "a".repeat(3000), refresh_token: "r".repeat(500) });
    await storage.setItem("sb-localhost-auth-token", session);
    expect(await storage.getItem("sb-localhost-auth-token")).toBe(session);
    expect([...data.values()].every((v) => v.length <= 1800)).toBe(true);
  });

  it("removes every chunk on sign-out and shrinks cleanly when a shorter value is written", async () => {
    const { store, data } = memoryStore();
    const storage = createChunkedSecureStorage(store);
    await storage.setItem("k", "x".repeat(5000));
    await storage.setItem("k", "short");
    expect(await storage.getItem("k")).toBe("short");
    expect(data.size).toBe(2);
    await storage.removeItem("k");
    expect(data.size).toBe(0);
    expect(await storage.getItem("k")).toBeNull();
  });

  it("treats a missing chunk as signed out rather than returning a corrupt session", async () => {
    const { store, data } = memoryStore();
    const storage = createChunkedSecureStorage(store);
    await storage.setItem("k", "y".repeat(4000));
    data.delete("k.1");
    expect(await storage.getItem("k")).toBeNull();
  });
});
