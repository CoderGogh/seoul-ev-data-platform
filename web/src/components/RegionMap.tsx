// 대상 3개 구 행정동 지도 (SVG, 평면 투영)
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { geoPath, geoTransform } from "d3-geo";
import {
  CLASS_LABEL,
  HINT_LABEL,
  HINT_ORDER,
  fmtInt,
  fmtPct,
  type AdmdongGeo,
  type AdmdongProps,
  type Region,
} from "../data";
import { Tip } from "./Tip";

export type MapMode = "class" | "hint";

interface RegionMapProps {
  geo: AdmdongGeo;
  regions: Region[];
  mode: MapMode;
  matches?: Set<string>;
  activeCd?: string;
  height?: number;
  onSelect?: (admCd: string) => void;
}

const WIDTH = 640;
const PAD = 8;
// 서울 위도 경도 보정
const LAT_K = Math.cos((37.5 * Math.PI) / 180);

function fillOf(region: Region | undefined, isTarget: boolean, mode: MapMode) {
  if (!isTarget || !region) return "var(--outside)";
  if (mode === "hint") return region.charger_hint ? `var(--hint-${region.charger_hint})` : "var(--ref)";
  return region.classification === "A" ? "var(--accent)" : "var(--ref)";
}

export function RegionMap({ geo, regions, mode, matches, activeCd, height, onSelect }: RegionMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; props: AdmdongProps } | null>(null);
  const byCd = useMemo(() => new Map(regions.map((r) => [r.adm_cd, r])), [regions]);

  // 대상 구 경계만 사용
  const features = useMemo(() => {
    const sggs = new Set(regions.map((r) => r.sgg_nm));
    return geo.features.filter((f) => sggs.has(f.properties.sgg_nm));
  }, [geo, regions]);

  // 경계 범위 → 화면 좌표 변환
  const { paths, viewHeight } = useMemo(() => {
    const raw = geoTransform({
      point(x, y) {
        this.stream.point(x * LAT_K, -y);
      },
    });
    const fc = { type: "FeatureCollection" as const, features };
    const [[x0, y0], [x1, y1]] = geoPath(raw).bounds(fc);
    const s = (WIDTH - PAD * 2) / (x1 - x0);
    const h = (y1 - y0) * s + PAD * 2;
    const fit = geoTransform({
      point(x, y) {
        this.stream.point((x * LAT_K - x0) * s + PAD, (-y - y0) * s + PAD);
      },
    });
    const path = geoPath(fit);
    return { paths: features.map((f) => ({ props: f.properties, d: path(f) ?? "" })), viewHeight: h };
  }, [features]);

  const showTip = (e: MouseEvent, props: AdmdongProps) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    // 오른쪽 끝에서는 왼쪽으로 표시
    setTip({ x: x > box.width - 180 ? x - 176 : x + 14, y: e.clientY - box.top + 14, props });
  };

  const onKey = (e: KeyboardEvent, cd: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(cd);
    }
  };

  const tipRegion = tip ? byCd.get(tip.props.adm_cd) : undefined;

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        className="map"
        viewBox={`0 0 ${WIDTH} ${viewHeight}`}
        style={height ? { maxHeight: height } : undefined}
        role="img"
        aria-label="강남·서초·송파 행정동 지도"
      >
        {paths.map(({ props, d }) => {
          const region = byCd.get(props.adm_cd);
          const isTarget = props.is_target && !!region;
          const cls = [
            isTarget ? "target" : "",
            matches && isTarget && !matches.has(props.adm_cd) ? "dim" : "",
            activeCd === props.adm_cd ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <path
              key={props.adm_cd}
              d={d}
              className={cls}
              fill={fillOf(region, isTarget, mode)}
              tabIndex={isTarget && onSelect ? 0 : undefined}
              aria-label={isTarget ? `${region!.adm_nm} ${CLASS_LABEL[region!.classification]}` : undefined}
              onMouseMove={isTarget ? (e) => showTip(e, props) : undefined}
              onMouseLeave={() => setTip(null)}
              onClick={isTarget && onSelect ? () => onSelect(props.adm_cd) : undefined}
              onKeyDown={isTarget && onSelect ? (e) => onKey(e, props.adm_cd) : undefined}
            />
          );
        })}
      </svg>
      {tip && tipRegion && (
        <Tip
          style={{ left: tip.x, top: tip.y }}
          title={`${tipRegion.sgg_nm} ${tipRegion.adm_nm}`}
          rows={[
            ["분류", CLASS_LABEL[tipRegion.classification]],
            ["전기차", `${fmtInt(tipRegion.ev_cnt)}대`],
            ["1년 증가율", fmtPct(tipRegion.ev_yoy_rate)],
            ["도로 여건", tipRegion.charger_hint ? HINT_LABEL[tipRegion.charger_hint] : "-"],
          ]}
        />
      )}
      <MapLegend mode={mode} hasOutside={paths.some(({ props }) => !byCd.has(props.adm_cd))} />
    </div>
  );
}

function MapLegend({ mode, hasOutside }: { mode: MapMode; hasOutside: boolean }) {
  return (
    <div className="legend" style={{ marginTop: 8 }}>
      {mode === "class" ? (
        <>
          <span>
            <i className="swatch" style={{ background: "var(--accent)" }} />
            {CLASS_LABEL.A}
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--ref)" }} />
            {CLASS_LABEL.REF}
          </span>
        </>
      ) : (
        HINT_ORDER.map((h) => (
          <span key={h}>
            <i className="swatch" style={{ background: `var(--hint-${h})` }} />
            {HINT_LABEL[h]}
          </span>
        ))
      )}
      {hasOutside && (
        <span>
          <i className="swatch" style={{ background: "var(--outside)", border: "1px solid var(--border)" }} />
          분석 대상 외
        </span>
      )}
    </div>
  );
}
