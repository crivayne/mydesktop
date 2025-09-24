import React from "react";
import { IModelApp, DisplayStyle3dState } from "@itwin/core-frontend";
import { ColorDef, SkyBox, SkyGradient } from "@itwin/core-common";

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

  // ---- Background Color (선택된 뷰에 즉시 적용) ----
  const [bgHex, setBgHex] = React.useState<string>("#1e1e1e");
  const [useGradient, setUseGradient] = React.useState<boolean>(false);  // 그라데이션 사용 여부
  const [gradTop, setGradTop] = React.useState<string>("#2b2b2b");      // 그라데이션 상단색
  const [gradBottom, setGradBottom] = React.useState<string>("#0f0f0f"); // 그라데이션 하단색
  const [skybox, setSkybox] = React.useState<boolean>(false);            // 스카이박스 표시
  const [bgMap, setBgMap] = React.useState<boolean>(false);              // 배경맵(위성지도) 표시


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
    setBgMap(Boolean(vf?.backgroundMap));

    // 배경/스카이 상태 반영 (3D 뷰에서만)
    if (vp?.view.is3d()) {
      const ds3d = vp.view.displayStyle as DisplayStyle3dState;
      const curHex =
        ds3d.backgroundColor?.toHexString
          ? ds3d.backgroundColor.toHexString()
          : "#1e1e1e";
      const safeHex =
        typeof curHex === "string" && curHex.startsWith("#") && curHex.length >= 7
          ? curHex.slice(0, 7)
          : "#1e1e1e";
      setBgHex(safeHex);

      // displaySky는 3D 환경에만 존재
      setSkybox(Boolean(ds3d.environment.displaySky));
      // 현재 SkyBox가 그라데이션인지 정확 판별은 버전에 따라 다르므로 초기값 false
      setUseGradient(false);
    } else {
      // 2D 뷰 등에서는 skybox/gradient 비활성화
      setSkybox(false);
      setUseGradient(false);
    }
  }, [props.open]);

  const applyTileAndMemory = () => {
    IModelApp.tileAdmin.defaultTileSizeModifier = Number(tileMul || 1);
    IModelApp.tileAdmin.gpuMemoryLimit = toBytes(Number(isNaN(gpuMb) ? 0 : gpuMb));
  };

  const applyViewFlags = () => {
    const vp = getSelectedView();
    if (!vp) return;
    const next = vp.viewFlags.copy({
      shadows,
      ambientOcclusion: ao,
      visibleEdges: edges,
      transparency,
      backgroundMap: bgMap, // ★ 배경맵은 ViewFlags로
    });
    vp.viewFlags = next;
    vp.invalidateRenderPlan();
  };

  // 배경/스카이 적용 (3D 전용 처리 포함)
  const applyBackground = () => {
    const vp = getSelectedView();
    if (!vp) return;

    // 배경맵은 ViewFlags에서 이미 반영하므로 여기선 스타일만 처리
    const ds = vp.view.displayStyle;

    // 단색 배경(2D/3D 공통)
    ds.backgroundColor = ColorDef.fromString(bgHex);

    // 스카이/그라데이션은 3D에서만
    if (vp.view.is3d()) {
      const ds3d = ds as DisplayStyle3dState;

      if (useGradient) {
        // SkyGradient → SkyBox 생성 후 표시
        const gradient = SkyGradient.create({
          twoColor: true,
          skyColor: ColorDef.fromString(gradTop),      // 상단색
          groundColor: ColorDef.fromString(gradBottom) // 하단색
        });
        const sky = SkyBox.createGradient(gradient);
        const env = ds3d.environment.clone({ sky: sky, displaySky: true });
        ds3d.environment = env;
        setSkybox(true); // UI 동기화
      } else {
        // 단색 모드에서는 skybox 토글만 반영
        const env = ds3d.environment.clone({ displaySky: skybox });
        ds3d.environment = env;
      }
    }

    vp.invalidateRenderPlan();
  };

  const applyAll = () => {
    applyTileAndMemory();
    applyViewFlags();
    applyBackground();
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
        backgroundMap: false,
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
        backgroundMap: bgMap,
      });
      vp.viewFlags = next;
      vp.invalidateRenderPlan();
    }
  };

  const hasView = !!getSelectedView();
  const is3d = getSelectedView()?.view.is3d?.() ?? false;

  if (!props.open) return null;

  return (
    <div style={{
      width: 520,
      background: "#1e1e1e",
      border: "1px solid #333",
      borderRadius: 10,
      padding: 16,
      maxHeight: "70vh",
      overflowY: "auto"
    }}>
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

      {/* Background / Skybox / Map */}
      <div style={{borderTop:"1px solid #333", paddingTop:12, marginTop:12}}>
        <h4 style={{margin:"0 0 8px"}}>Background</h4>

        {/* 배경맵/스카이박스/그라데이션 토글 */}
        <div style={{display:"flex", gap:18, flexWrap:"wrap", marginBottom:10}}>
          <label style={{display:"flex", alignItems:"center", gap:8}}>
            <input type="checkbox" checked={bgMap} onChange={(e)=>setBgMap(e.target.checked)} disabled={!hasView}/>
            Background map
          </label>
          <label style={{display:"flex", alignItems:"center", gap:8}}>
            <input type="checkbox" checked={skybox} onChange={(e)=>setSkybox(e.target.checked)} disabled={!hasView || !is3d || useGradient}/>
            Skybox
          </label>
          <label style={{display:"flex", alignItems:"center", gap:8}}>
            <input type="checkbox" checked={useGradient} onChange={(e)=>setUseGradient(e.target.checked)} disabled={!hasView || !is3d}/>
            Gradient sky
          </label>
        </div>

        {/* 단색 모드 */}
        {!useGradient && (
          <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:10}}>
            <input
              type="color"
              value={bgHex}
              onChange={(e)=>setBgHex(e.target.value)}
              disabled={!hasView}
              aria-label="Background color"
            />
            <input
              type="text"
              value={bgHex}
              onChange={(e)=>setBgHex(e.target.value)}
              placeholder="#RRGGBB"
              disabled={!hasView}
              style={{width:110}}
            />
            <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
              <button onClick={()=>setBgHex("#1e1e1e")} disabled={!hasView}>Dark</button>
              <button onClick={()=>setBgHex("#2b2b2b")} disabled={!hasView}>Slate</button>
              <button onClick={()=>setBgHex("#000000")} disabled={!hasView}>Black</button>
              <button onClick={()=>setBgHex("#ffffff")} disabled={!hasView}>White</button>
            </div>
          </div>
        )}

        {/* 그라데이션 모드 (3D 전용) */}
        {useGradient && (
          <div style={{display:"grid", gridTemplateColumns:"auto 1fr auto 1fr", columnGap:10, rowGap:8, alignItems:"center", marginBottom:6}}>
            <div>Top</div>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <input type="color" value={gradTop} onChange={(e)=>setGradTop(e.target.value)} disabled={!hasView || !is3d}/>
              <input type="text" value={gradTop} onChange={(e)=>setGradTop(e.target.value)} placeholder="#RRGGBB" disabled={!hasView || !is3d} style={{width:110}}/>
            </div>
            <div>Bottom</div>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <input type="color" value={gradBottom} onChange={(e)=>setGradBottom(e.target.value)} disabled={!hasView || !is3d}/>
              <input type="text" value={gradBottom} onChange={(e)=>setGradBottom(e.target.value)} placeholder="#RRGGBB" disabled={!hasView || !is3d} style={{width:110}}/>
            </div>
          </div>
        )}

        <div style={{opacity:.7, fontSize:12, marginTop:2}}>
          배경맵이 켜져 있으면 단색/그라데이션은 거의 보이지 않습니다. 그라데이션은 3D에서 Skybox로 적용됩니다.
        </div>

        <div style={{display:"flex", gap:8, marginTop:10}}>
          <button onClick={applyBackground} disabled={!hasView}>Apply background</button>
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
  );
}