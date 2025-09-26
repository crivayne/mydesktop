// src/frontend/components/library/ModelLibraryPanel.tsx
import React from "react";

export default function ModelLibraryPanel() {
  return (
    <div style={{ opacity:.9 }}>
      <h3 style={{ marginTop: 0 }}>Model Library (glTF / GLB)</h3>

      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <button disabled>Upload (soon)</button>
        <button disabled>Refresh (soon)</button>
      </div>

      <div style={{ padding:12, border:"1px dashed #444", borderRadius:8 }}>
        모델(gltf/glb) 업로드 & 리스트/삭제/배치 기능을 여기에 구현 예정입니다.
      </div>
    </div>
  );
}