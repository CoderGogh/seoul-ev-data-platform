// 배경지도 (브이월드 WMTS): 웹 메르카토르 좌표·타일 목록. 화면 표시만, 타일 저장 없음
import { useEffect, useState } from "react";

const KEY = (import.meta.env.VITE_VWORLD_KEY as string | undefined) || "";
const TILE = 256;
export const MIN_Z = 6;
export const MAX_Z = 18;

export type BaseLayer = "white" | "midnight";

export function basemapEnabled() {
  return KEY !== "";
}

// 경위도 → 세계 좌표 (0~1, 웹 메르카토르)
export function mercX(lng: number) {
  return (lng + 180) / 360;
}
export function mercY(lat: number) {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

// 화면 폭에 맞는 줌: 세계 좌표 폭 × 타일 수가 화면 픽셀 이상
export function pickZoom(worldWidth: number, pixelWidth: number) {
  const z = Math.ceil(Math.log2(pixelWidth / (worldWidth * TILE)));
  return Math.max(MIN_Z, Math.min(MAX_Z, z));
}

export interface Tile {
  z: number;
  x: number;
  y: number;
  wx: number; // 왼쪽 위 세계 좌표
  wy: number;
  size: number; // 세계 좌표 한 변
}

// 범위를 덮는 타일 (세계 좌표 [x0, y0, x1, y1])
export function tilesFor([x0, y0, x1, y1]: [number, number, number, number], z: number): Tile[] {
  const n = 2 ** z;
  const size = 1 / n;
  const out: Tile[] = [];
  for (let x = Math.floor(x0 * n); x <= Math.floor(x1 * n); x++) {
    for (let y = Math.floor(y0 * n); y <= Math.floor(y1 * n); y++) {
      out.push({ z, x, y, wx: x * size, wy: y * size, size });
    }
  }
  return out;
}

// WMTS 주소: {layer}/{TileMatrix}/{TileRow}/{TileCol}
export function tileUrl(t: Tile, layer: BaseLayer, key = KEY) {
  return `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/${t.z}/${t.y}/${t.x}.png`;
}

// 문서 테마 → 배경지도 층 (테마 전환 시 갱신)
export function useBaseLayer(): BaseLayer {
  const read = (): BaseLayer => (document.documentElement.dataset.theme === "dark" ? "midnight" : "white");
  const [layer, setLayer] = useState<BaseLayer>(read);
  useEffect(() => {
    const ob = new MutationObserver(() => setLayer(read()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);
  return layer;
}

// 배경지도 표시 여부 (브라우저에 저장)
const PREF = "basemap";
export function readBasemapPref() {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}
export function saveBasemapPref(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    // 저장 불가 환경은 무시
  }
}
