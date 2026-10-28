"use client";
// The only client JavaScript in the ticket screens (DD-6): each file goes straight from the browser to storage
// through a signed upload URL, then its upload id joins the raise form as a hidden field. The server checks
// the stored object's real size and file signature when the ticket is raised.
import { useState } from "react";

type Item = { name: string; state: "uploading" | "done" | "refused"; uploadId?: string };

export default function Upload({ typeId, centreId, form }: { typeId: number; centreId: number; form: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const set = (i: number, it: Item) => setItems((xs) => xs.map((x, j) => (j === i ? it : x)));

  async function choose(files: FileList | null) {
    const list = [...(files ?? [])];
    const start = items.length;
    setItems((xs) => [...xs, ...list.map((f) => ({ name: f.name, state: "uploading" as const }))]);
    await Promise.all(list.map(async (file, k) => {
      const i = start + k;
      try {
        const r = await fetch("/tickets/uploads", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ typeId, centreId, fileName: file.name, size: file.size, contentType: file.type }),
        });
        if (!r.ok) return set(i, { name: file.name, state: "refused" });
        const { uploadId, url } = (await r.json()) as { uploadId: string; url: string };
        const put = await fetch(url, { method: "PUT", headers: { "content-type": file.type }, body: file });
        set(i, put.ok ? { name: file.name, state: "done", uploadId } : { name: file.name, state: "refused" });
      } catch {
        set(i, { name: file.name, state: "refused" });
      }
    }));
  }

  return (
    <fieldset>
      <legend>Documents (PDF, JPEG or PNG, up to 10 MB each)</legend>
      <input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(e) => void choose(e.target.files)} />
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            {it.name}: {it.state === "uploading" ? "uploading…" : it.state === "done" ? "uploaded" : "refused (wrong type, too large, or not allowed)"}
            {it.uploadId && <input type="hidden" name="uploadId" value={it.uploadId} form={form} />}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
