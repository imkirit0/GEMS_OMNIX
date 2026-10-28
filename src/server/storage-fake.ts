// In-memory storage for CI and tests (STORAGE_DRIVER=fake). It must never run live: it refuses to load on
// any Vercel deployment. Not tied to NODE_ENV, because CI builds and smoke-tests with NODE_ENV=production.
import type { StorageDriver } from "./storage";

if (process.env["VERCEL_ENV"]) throw new Error("the fake storage driver must not load on a Vercel deployment");

const objects = new Map<string, Uint8Array>();

export const fakeStorage: StorageDriver & { put(key: string, bytes: Uint8Array): void; clear(): void } = {
  async signedUploadUrl(key) { return `fake://${key}?expires=upload`; },
  async head(key, bytes) {
    const o = objects.get(key);
    return o ? { bytes: o.slice(0, bytes), totalSize: o.length } : null;
  },
  async signedDownloadUrl(key, seconds) { return `fake://${key}?expires=${seconds}`; },
  put(key, bytes) { objects.set(key, bytes); },
  clear() { objects.clear(); },
};
