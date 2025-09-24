// src/frontend/extensions/documents/DocumentsApi.ts
export type DocItem = {
  id: number;
  siteId: number;
  orig_name: string;
  curr_name: string;
  ext: string;
  uploadBy: string;
  uploadAt: string;
  lasteditBy?: string | null;
  lasteditAt?: string | null;
  state: "initial" | "renamed" | "deleted";
};

export type ListParams = { siteId: string; q?: string; ext?: string };

function apiBase() {
  try { return (JSON.parse(localStorage.getItem("auth")||"null")||{}).apiBase as string; }
  catch { return ""; }
}

export const DocumentsApi = {
  async list(p: ListParams): Promise<DocItem[]> {
    const base = apiBase().replace(/\/+$/,"");
    const qs = new URLSearchParams({ siteId: p.siteId });
    if (p.q) qs.set("q", p.q);
    if (p.ext) qs.set("ext", p.ext);
    const res = await fetch(`${base}/itwin/api/documents/list.php?${qs.toString()}`); //{ credentials:"include" });
    const json = await res.json();
    if (!json?.success) throw new Error(json?.message || "list failed");
    return json.items as DocItem[];
  },

  async upload(siteId: string, userId: string, file: File): Promise<DocItem> {
    const base = apiBase().replace(/\/+$/,"");
    const form = new FormData();
    form.append("siteId", siteId);
    form.append("userId", userId);
    form.append("file", file, file.name);
    const res = await fetch(`${base}/itwin/api/documents/upload.php`, { method:"POST", body: form, /*credentials:"include"*/ });
    const json = await res.json();
    if (!json?.success) throw new Error(json?.message || "upload failed");
    return json.item as DocItem;
  },

  async rename(siteId: string, id: number, newName: string, userId: string): Promise<void> {
    const base = apiBase().replace(/\/+$/,"");
    const res = await fetch(`${base}/itwin/api/documents/rename.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      //credentials: "include",
      body: JSON.stringify({ siteId, id, newName, userId }),
    });
    const json = await res.json();
    if (!json?.success) throw new Error(json?.message || "rename failed");
  },

  async markDelete(siteId: string, id: number, userId: string): Promise<void> {
    const base = apiBase().replace(/\/+$/,"");
    const res = await fetch(`${base}/itwin/api/documents/markDelete.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      //credentials: "include",
      body: JSON.stringify({ siteId, id, userId }),
    });
    const json = await res.json();
    if (!json?.success) throw new Error(json?.message || "delete failed");
  },

  downloadUrl(siteId: string, id: number): string {
    const base = apiBase().replace(/\/+$/,"");
    return `${base}/itwin/api/documents/download.php?siteId=${encodeURIComponent(siteId)}&id=${id}`;
  },

  openUrl(siteId: string, it: DocItem): string {
    // 브라우저에서 새 탭으로 “보기” 할 때 사용(서버에 직접 접근 가능하면)
    const fname = `${it.id}_${it.curr_name}.${it.ext}`;
    const base = apiBase().replace(/\/+$/,"");
    return `${base}/itwin/documents/${encodeURIComponent(siteId)}/${encodeURIComponent(fname)}`;
  },
};

export default DocumentsApi;