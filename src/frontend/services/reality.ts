import type { ScreenViewport } from "@itwin/core-frontend";
import type { ContextRealityModelProps } from "@itwin/core-common";

export function attachMeshReality(viewport: ScreenViewport, tilesetUrl: string, name = "RealityMesh") {
  const props: ContextRealityModelProps = { name, tilesetUrl };
  viewport.displayStyle.attachRealityModel(props);
  viewport.invalidateRenderPlan();
}

export function attachPointCloudOPC(
  viewport: ScreenViewport,
  opcEndpointUrl: string,
  name = "PointCloud",
) {
  // TS 타입만 우회 (런타임은 rdSourceKey만으로 OK)
  const props = {
    name,
    rdSourceKey: {
      provider: "OrbitGtBlob",
      format:   "OPC",
      id:       opcEndpointUrl,  // 예: http://.../metadata.json
    },
  } as unknown as ContextRealityModelProps;

  viewport.displayStyle.attachRealityModel(props);
}

export function attachByKind(viewport: ScreenViewport, kind: string, url: string, name?: string) {
  const k = (kind || "").toLowerCase();
  if (k === "opc") return attachPointCloudOPC(viewport, url, name);
  // '3sm'도 결과가 3D Tiles(tileset.json)면 동일 취급
  return attachMeshReality(viewport, url, name);
}