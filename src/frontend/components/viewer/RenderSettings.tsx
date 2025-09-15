import React from "react";
import { IModelApp } from "@itwin/core-frontend";

function getSelectedView() {
  return IModelApp.viewManager.selectedView;
}

export default function RenderSettings(props: { open: boolean; onClose: () => void }) {
  // ---- util ----
  const toMb = (bytes: unknown) => Math.max(0, Math.round(Number(bytes ?? 0) / (1024 * 1024)));
  const toBytes = (mb: number) => (mb > 0 ? mb * 1024 * 1024 : 0);

  // ---- Tile & Memory (즉시 적용) ----
  const [tileMul, setTileMul] = React.useState<number>(() =>
    Number(IModelApp.tileAdmin.defaultTileSizeModifier ?? 1)
  );
  const [gpuMb, setGpuMb] = React.useState<number>(() =>
    toMb(IModelApp.tileAdmin.gpuMemoryLimit)
  );

  // ---- Visual Effects (선택된 뷰에 즉시 적용) ----
  const [shadows, setShadows] = React.useState(false);
  const [ao, setAo] = React.useState(false);            // ambient occlusion
  const [edges, setEdges] = React.useState(false);      // visible edges
  const [transparency, setTransparency] = React.useState(true);

  // 모달 열릴 때 현재 상태 반영
  React.useEffect(() => {
    if (!props.open) return;

    // tile admin 현재값 반영
    setTileMul(Number(IModelApp.tileAdmin.defaultTileSizeModifier ?? 1));
    setGpuMb(toMb(IModelApp.tileAdmin.gpuMemoryLimit));

    // view flags 현재값 반영
    const vp = getSelectedView();
    const vf = vp?.viewFlags;
    setShadows(Boolean(vf?.shadows));
    setAo(Boolean(vf?.ambientOcclusion));
    setEdges(Boolean(vf?.visibleEdges));
    setTransparency(Boolean(vf?.transparency ?? true));
  }, [props.open]);

  const applyTileAndMemory = () => {
    IModelApp.tileAdmin.defaultTileSizeModifier = Number(tileMul || 1);
    IModelApp.tileAdmin.gpuMemoryLimit = toBytes(Number(isNaN(gpuMb) ? 0 : gpuMb));
  };

  const applyViewFlags = () => {
    const vp = getSelectedView();
    if (!vp) return;
    // ✅ ViewFlags는 readonly → copy(changedFlags)로 새 인스턴스 생성
    const next = vp.viewFlags.copy({
      shadows,
      ambientOcclusion: ao,
      visibleEdges: edges,
      transparency,
    });
    vp.viewFlags = next;
    vp.invalidateRenderPlan();
  };

  const applyAll = () => {
    applyTileAndMemory();
    applyViewFlags();
    props.onClose();
  };

  // 프리셋
  const applySafePreset = () => {
    // 큰 모델에 안정적인 값
    const mul = 1.8;
    const memMb = 1024;

    setTileMul(mul);
    setGpuMb(memMb);
    setShadows(false);
    setAo(false);
    setEdges(false);
    setTransparency(true);

    // 즉시 반영
    IModelApp.tileAdmin.defaultTileSizeModifier = mul;
    IModelApp.tileAdmin.gpuMemoryLimit = toBytes(memMb);

    const vp = getSelectedView();
    if (vp) {
      const next = vp.viewFlags.copy({
        shadows: false,
        ambientOcclusion: false,
        visibleEdges: false,
        transparency: true,
      });
      vp.viewFlags = next;
      vp.invalidateRenderPlan();
    }
  };

  const applyQualityPreset = () => {
    const mul = 1.0;
    const memMb = 0; // 무제한(주의)

    setTileMul(mul);
    setGpuMb(memMb);
    setShadows(true);
    setAo(true);
    setEdges(true);
    setTransparency(true);

    // 즉시 반영
    IModelApp.tileAdmin.defaultTileSizeModifier = mul;
    IModelApp.tileAdmin.gpuMemoryLimit = toBytes(memMb);

    const vp = getSelectedView();
    if (vp) {
      const next = vp.viewFlags.copy({
        shadows: true,
        ambientOcclusion: true,
        visibleEdges: true,
        transparency: true,
      });
      vp.viewFlags = next;
      vp.invalidateRenderPlan();
    }
  };

  const hasView = !!getSelectedView();
  if (!props.open) return null;

  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
      <div style={{width:480, background:"#1e1e1e", border:"1px solid #333", borderRadius:10, padding:16}}>
        <h3 style={{marginTop:0}}>Rendering settings</h3>

        {/* Tiles & Memory */}
        <div style={{borderTop:"1px solid #333", paddingTop:12}}>
          <h4 style={{margin:"0 0 8px"}}>Tiles & Memory</h4>

          <label style={{display:"block", margin:"10px 0 4px"}}>Default tile size modifier (0.5 ~ 4.0)</label>
          <input
            type="range" min={0.5} max={4} step={0.25}
            value={tileMul} onChange={(e)=>setTileMul(parseFloat(e.target.value))}
            style={{width:"100%"}}
          />
          <div style={{opacity:.8, fontSize:12}}>현재: {Number(tileMul).toFixed(2)}</div>

          <label style={{display:"block", margin:"14px 0 4px"}}>GPU memory limit (MB, 0=무제한)</label>
          <input
            type="number" min={0} step={128}
            value={isNaN(Number(gpuMb)) ? 0 : gpuMb}
            onChange={(e)=>setGpuMb(parseInt(e.target.value || "0", 10))}
            style={{width:140}}
          />
          <div style={{opacity:.7, fontSize:12, marginTop:4}}>
            너무 낮으면 타일이 자주 폐기/재요청되어 느려질 수 있습니다.
          </div>

          <div style={{display:"flex", gap:8, marginTop:10}}>
            <button onClick={applyTileAndMemory}>Apply tiles & memory</button>
          </div>
        </div>

        {/* Visual Effects */}
        <div style={{borderTop:"1px solid #333", paddingTop:12, marginTop:12}}>
          <h4 style={{margin:"0 0 8px"}}>Visual effects</h4>
          {!hasView && <div style={{fontSize:12, opacity:.7, marginBottom:8}}>활성 뷰가 없습니다. 뷰어에서 모델을 연 뒤 적용하세요.</div>}

          <label style={{display:"flex", alignItems:"center", gap:8, margin:"6px 0"}}>
            <input type="checkbox" checked={shadows} onChange={(e)=>setShadows(e.target.checked)} disabled={!hasView}/>
            Shadows
          </label>
          <label style={{display:"flex", alignItems:"center", gap:8, margin:"6px 0"}}>
            <input type="checkbox" checked={ao} onChange={(e)=>setAo(e.target.checked)} disabled={!hasView}/>
            Ambient occlusion (SSAO)
          </label>
          <label style={{display:"flex", alignItems:"center", gap:8, margin:"6px 0"}}>
            <input type="checkbox" checked={edges} onChange={(e)=>setEdges(e.target.checked)} disabled={!hasView}/>
            Visible edges
          </label>
          <label style={{display:"flex", alignItems:"center", gap:8, margin:"6px 0"}}>
            <input type="checkbox" checked={transparency} onChange={(e)=>setTransparency(e.target.checked)} disabled={!hasView}/>
            Transparency
          </label>

          <div style={{display:"flex", gap:8, marginTop:10}}>
            <button onClick={applyViewFlags} disabled={!hasView}>Apply effects</button>
          </div>
        </div>

        {/* Presets */}
        <div style={{borderTop:"1px solid #333", paddingTop:12, marginTop:12}}>
          <h4 style={{margin:"0 0 8px"}}>Presets</h4>
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <button onClick={applySafePreset}>Safe (Heavy)</button>
            <button onClick={applyQualityPreset}>Quality</button>
          </div>
        </div>

        <div style={{display:"flex", justifyContent:"flex-end", gap:8, marginTop:16}}>
          <button onClick={props.onClose}>닫기</button>
          <button onClick={applyAll}>모두 적용 후 닫기</button>
        </div>
      </div>
    </div>
  );
}