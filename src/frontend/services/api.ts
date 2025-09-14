// src/frontend/services/api.ts
type SiteRow = {
  id: string;                // uuid (sites.id)
  projectId?: string | null; // sites.projectId
  name: string;
  thumbnail?: string | null;
  iTwinId?: string | null;   // (컬럼 tiwnId 표기 주의)
  iModelId?: string | null;
  file_type?: string | null;
  kind?: string | null;      // 'snapshot' 기본
  snapshotUrl?: string | null; // 최근 로드 경로(있다면)
  snapshot_url?: string | null;
  createdAt?: string;
  createdBy?: string;
  [k: string]: any;
};

type SnapshotRow = {
  id: number;                // snapshotlist.id (auto inc)
  snapshotGuid?: string | null;
  projectId?: string | null;
  siteId: string;            // uuid
  name: string;
  url: string;               // 실제 파일 경로(로컬/공유폴더/네트워크)
  file_type?: string | null;
  size_bytes?: number | null;
  createdBy?: string | null;
  createdAt?: string;
};

// 로그인 응답은 네 기존 LoginPanel이 처리하므로 여기선 생략

// 항상 /itwin/api 로 끝나도록 보정
function normalizeBase(raw?: string) {
  const b = (raw || "").trim().replace(/\/+$/, "");
  return b ? (b.endsWith("/itwin/api") ? b : b + "/itwin/api") : "";
}
function base(): string {
  const a = normalizeBase(localStorage.getItem("itwin-api-base") || "");
  const e = normalizeBase((import.meta as any).env?.VITE_PHP_API_BASE || "");
  return a || e || `${location.protocol}//${location.host}/itwin/api`;
}

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

async function tryJson<T>(req: Promise<Response>): Promise<T> {
  const r = await req; if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function normalizeSite(r: SiteRow): SiteRow & { snapshotUrl?: string | null } {
  return { ...r, snapshotUrl: r.snapshotUrl ?? r.snapshot_url ?? r.snapshot ?? null };
}

export const Api = {
  // ---- Sites ----
  async listSites(): Promise<SiteRow[]> {
    const r = await fetch(`${base()}/sites/list.php`, { headers: jsonHeaders() });
    return r.json();
  },

  async createSite(name: string) {
    const userId = localStorage.getItem("itwin-user-id") || "";
    const r = await fetch(`${base()}/sites/create.php`, {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ name, createdBy: userId }),
    });
    return r.json();
  },

  async renameSite(id: string, name: string) {
    const r = await fetch(`${base()}/sites/rename.php`, {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ id, name }),
    });
    return r.json();
  },

  async deleteSite(id: string) {
    const r = await fetch(`${base()}/sites/delete.php`, {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ id }),
    });
    return r.json();
  },

  // 하나만 필요하면 list에서 필터 (단일 API가 따로 없을 때)
  async getSite(siteId: string): Promise<SiteRow | null> {
    const b = base();
    // 두 패턴 다 시도 (서버 구현차 대비)
    const tryUrls = [
      `${b}/sites/list.php?siteId=${encodeURIComponent(siteId)}`,
      `${b}/sites/list.php?id=${encodeURIComponent(siteId)}`,
    ];
    for (const u of tryUrls) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const data = await r.json();
        const arr = Array.isArray(data) ? data : (data?.rows ?? []);
        if (Array.isArray(arr) && arr.length > 0) return normalizeSite(arr[0]);
      } catch {}
    }
    return null;
  },

  // 사이트의 “최근 스냅샷”을 돌려주는 엔드포인트 사용
  async listSiteSnapshots(siteId: string) {
    const r = await fetch(`${base()}/sites/listSnapshots.php?siteId=${encodeURIComponent(siteId)}`);
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<Array<{ id:string; name:string; url:string }>>;
  },

  /** 전체 스냅샷 목록 (사이트 구분 없이) */
  async listSnapshotsAll(): Promise<SnapshotRow[]> {
    const r = await fetch(`${base()}/snapshots/list.php`);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  },

  /** ✅ 글로벌 업로드(서버의 지정 폴더로 저장) — siteId 없음 */
    async uploadSnapshotGlobal(file: File, name?: string) {
        const fd = new FormData();
        fd.append("snapshot", file);                   // ✅ 서버와 일치 ($_FILES['snapshot'])
        if (name) fd.append("name", name);
        const createdBy = localStorage.getItem("itwin-user-id") || "";
        if (createdBy) fd.append("createdBy", createdBy);

        const r = await fetch(`${base()}/snapshots/uploadsnapshot.php`, { method: "POST", body: fd });
        const text = await r.text();
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text}`);
        let json: any; try { json = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${text}`); }

        // ✅ success 또는 ok 둘 다 허용
        if (!(json?.success ?? json?.ok)) {
            throw new Error(`서버에러: ${json?.message || "업로드 실패"}`);
        }
        return json;
    },

  // ✅ 최근 스냅샷 기록: setLastOpened.php 규격에 맞춤 (snapshotId 불필요)
  async setSiteLastOpened(siteId: string, snapshotUrl: string) {
    const r = await fetch(`${base()}/sites/setLastOpened.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, snapshotUrl }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} - ${text}`);
    try { return JSON.parse(text); } catch { return { success: true }; }
  },

  // ---- Logs (선택) ----
  async writeLog(action: string, targetType: "project" | "site", targetId: string, detail?: string) {
    const userId = localStorage.getItem("itwin-user-id") || "";
    await fetch(`${base()}/logs/write.php`, {
      method: "POST", headers: jsonHeaders(),
      body: JSON.stringify({ userId, action, targetType, targetId, detail }),
    });
  },
};
export type { SiteRow, SnapshotRow };