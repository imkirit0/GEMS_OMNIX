// Document storage for tickets (ADR-002; design §Storage). Private Supabase bucket reached with fetch, so no SDK.
// The driver is chosen on first use, not at import, so `next build` never needs storage settings.
// STORAGE_DRIVER=fake (CI, tests) uses an in-memory map from storage-fake.ts, which refuses to load on Vercel.

export type StoredHead = { bytes: Uint8Array; totalSize: number };
export type StorageDriver = {
  /** absolute URL the browser PUTs one file to; overwriting is off, so a checked object cannot be replaced */
  signedUploadUrl(key: string): Promise<string>;
  /** the first `bytes` bytes and the real total size, or null when the object does not exist */
  head(key: string, bytes: number): Promise<StoredHead | null>;
  /** absolute, short-lived download URL */
  signedDownloadUrl(key: string, seconds: number): Promise<string>;
};

let driver: Promise<StorageDriver> | undefined;

export function storage(): Promise<StorageDriver> {
  driver ??= choose();
  return driver;
}

async function choose(): Promise<StorageDriver> {
  if (process.env["STORAGE_DRIVER"] === "fake") return (await import("./storage-fake")).fakeStorage;
  const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_KEY"], bucket = process.env["TICKET_BUCKET"];
  if (!url || !key || !bucket) throw new Error("storage is not configured: set STORAGE_DRIVER=fake or SUPABASE_URL, SUPABASE_SERVICE_KEY and TICKET_BUCKET");
  return supabase(url.replace(/\/$/, ""), key, bucket);
}

// Supabase Storage REST API. The three call shapes are confirmed in the manual Supabase run (ADR-002 §6).
function supabase(base: string, key: string, bucket: string): StorageDriver {
  const auth = { authorization: `Bearer ${key}`, apikey: key };
  const path = (k: string) => `${encodeURIComponent(bucket)}/${k.split("/").map(encodeURIComponent).join("/")}`;
  const ok = async (r: Response, what: string) => {
    if (!r.ok) throw new Error(`storage ${what} failed: ${r.status}`); // status only: bodies may echo the request
    return r;
  };
  return {
    async signedUploadUrl(k) {
      const r = await ok(await fetch(`${base}/storage/v1/object/upload/sign/${path(k)}`,
        { method: "POST", headers: { ...auth, "x-upsert": "false" } }), "upload sign");
      const { url } = (await r.json()) as { url: string };
      return `${base}/storage/v1${url}`;
    },
    async head(k, bytes) {
      const r = await fetch(`${base}/storage/v1/object/authenticated/${path(k)}`, { headers: { ...auth, range: `bytes=0-${bytes - 1}` } });
      if (r.status === 400 || r.status === 404) return null;
      await ok(r, "read");
      const body = new Uint8Array(await r.arrayBuffer());
      // 206 gives "bytes 0-15/<total>"; a server that ignores Range sends the whole object with 200
      const total = Number(r.headers.get("content-range")?.split("/")[1] ?? (r.status === 200 ? body.length : NaN));
      if (!Number.isFinite(total)) throw new Error("storage read: no object size");
      return { bytes: body.slice(0, bytes), totalSize: total };
    },
    async signedDownloadUrl(k, seconds) {
      const r = await ok(await fetch(`${base}/storage/v1/object/sign/${path(k)}`,
        { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: seconds }) }), "download sign");
      const { signedURL } = (await r.json()) as { signedURL: string };
      return `${base}/storage/v1${signedURL}`;
    },
  };
}
