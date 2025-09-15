// RenderSettings.tsx
import React from "react";
import { IModelApp } from "@itwin/core-frontend";

export default function RenderSettings(props: { open: boolean; onClose: () => void }) {
  const [tileMul, setTileMul] = React.useState<number>(() => IModelApp.tileAdmin.defaultTileSizeModifier ?? 1);
  const [gpuMb, setGpuMb] = React.useState<number>(() => Math.round(Number(IModelApp.tileAdmin.gpuMemoryLimit ?? 0) / (1024*1024)));

  const apply = () => {
    // 전역 타일 크기 배수
    IModelApp.tileAdmin.defaultTileSizeModifier = tileMul;   // 즉시 적용
    // GPU 메모리 제한 (0이면 무제한)
    IModelApp.tileAdmin.gpuMemoryLimit = gpuMb > 0 ? gpuMb * 1024 * 1024 : 0;
    props.onClose();
  };

  if (!props.open) return null;
  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
      <div style={{width:420, background:"#1e1e1e", border:"1px solid #333", borderRadius:10, padding:16}}>
        <h3 style={{marginTop:0}}>Rendering settings</h3>

        <label style={{display:"block", margin:"10px 0 4px"}}>Default tile size modifier (0.5 ~ 4.0)</label>
        <input
          type="range" min={0.5} max={4} step={0.25}
          value={tileMul} onChange={(e)=>setTileMul(parseFloat(e.target.value))}
          style={{width:"100%"}}
        />
        <div style={{opacity:.8, fontSize:12}}>현재: {tileMul.toFixed(2)}</div>

        <label style={{display:"block", margin:"14px 0 4px"}}>GPU memory limit (MB, 0=무제한)</label>
        <input
          type="number" min={0} step={128}
          value={gpuMb} onChange={(e)=>setGpuMb(parseInt(e.target.value||"0",10))}
          style={{width:120}}
        />
        <div style={{opacity:.7, fontSize:12, marginTop:4}}>
          너무 낮으면 타일이 자주 폐기/재요청되어 느려질 수 있어요.
        </div>

        <div style={{display:"flex", justifyContent:"flex-end", gap:8, marginTop:16}}>
          <button onClick={props.onClose}>취소</button>
          <button onClick={apply}>적용</button>
        </div>
      </div>
    </div>
  );
}