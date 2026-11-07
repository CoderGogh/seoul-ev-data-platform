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

export type MapMode = "class" | "hint" | "supply";

// 충전소 점 (경위도)
export interface MapPoint {
  lng: number;
  lat: number;
  fast: boolean;
}

// 공급 단계: 충전기 1대당 전기차 / 기준 (1 미만 충분, 1·2·3배 구간)
export function supplyStep(evPerCharger: number | null, min: number): number | null {
  if (evPerCharger == null) return null;
  return Math.min(3, Math.floor(evPerCharger / min));
}

interface RegionMapProps {
  geo: AdmdongGeo;
  regions: Region[];
  mode: MapMode;
  matches?: Set<string>;
  activeCd?: string;
  height?: number;
  supplyMin?: number;
  points?: MapPoint[];
  onSelect?: (admCd: string) => void;
}

const WIDTH = 640;
const PAD = 8;
// 서울 위도 경도 보정
const LAT_K = Math.cos((37.5 * Math.PI) / 180);

function fillOf(region: Region | undefined, isTarget: boolean, mode: MapMode, supplyMin = 1) {
  if (!isTarget || !region) return "var(--outside)";
  if (mode === "supply") {
    const step = supplyStep(region.ev_per_charger, supplyMin);
    return step == null ? "var(--ref)" : `var(--sup-${step})`;
  }
  if (mode === "hint") return region.charger_hint ? `var(--hint-${region.charger_hint})` : "var(--ref)";
  return region.classification === "A" ? "var(--accent)" : "var(--ref)";
}

export function RegionMap({ geo, regions, mode, matches, activeCd, height, supplyMin, points, onSelect }: RegionMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; props: AdmdongProps } | null>(null);
  const byCd = useMemo(() => new Map(regions.map((r) => [r.adm_cd, r])), [regions]);

  // 대상 구 경계만 사용
  const features = useMemo(() => {
    const sggs = new Set(regions.map((r) => r.sgg_nm));
    return geo.features.filter((f) => sggs.has(f.properties.sgg_nm));
  }, [geo, regions]);

  // 경계 범위 → 화면 좌표 변환
  const { paths, viewHeight, project } = useMemo(() => {
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
    const project = (lng: number, lat: number) => [(lng * LAT_K - x0) * s + PAD, (-lat - y0) * s + PAD];
    return { paths: features.map((f) => ({ props: f.properties, d: path(f) ?? "" })), viewHeight: h, project };
  }, [features]);

  // 점 좌표 (급속은 위에 그림)
  const dots = useMemo(
    () =>
      (points ?? [])
        .map((p) => ({ xy: project(p.lng, p.lat), fast: p.fast }))
        .sort((a, b) => Number(a.fast) - Number(b.fast)),
    [points, project],
  );

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
              fill={fillOf(region, isTarget, mode, supplyMin)}
              tabIndex={isTarget && onSelect ? 0 : undefined}
              aria-label={isTarget ? `${region!.adm_nm} ${CLASS_LABEL[region!.classification]}` : undefined}
              onMouseMove={isTarget ? (e) => showTip(e, props) : undefined}
              onMouseLeave={() => setTip(null)}
              onClick={isTarget && onSelect ? () => onSelect(props.adm_cd) : undefined}
              onKeyDown={isTarget && onSelect ? (e) => onKey(e, props.adm_cd) : undefined}
            />
          );
        })}
        {dots.length > 0 && (
          <g className="map-dots" aria-hidden="true">
            {dots.map((d, i) => (
              <circle key={i} cx={d.xy[0]} cy={d.xy[1]} r={d.fast ? 2.2 : 1.5} className={d.fast ? "fast" : "slow"} />
            ))}
          </g>
        )}
      </svg>
      {tip && tipRegion && (
        <Tip
          style={{ left: tip.x, top: tip.y }}
          title={`${tipRegion.sgg_nm} ${tipRegion.adm_nm}`}
          rows={[
            ["분류", CLASS_LABEL[tipRegion.classification]],
            ["전기차", `${fmtInt(tipRegion.ev_cnt)}대`],
            ["1년 증가율", fmtPct(tipRegion.ev_yoy_rate)],
            mode === "supply"
              ? ["충전기 1대당", tipRegion.ev_per_charger == null ? "-" : `${tipRegion.ev_per_charger.toFixed(1)}대`]
              : ["도로 여건", tipRegion.charger_hint ? HINT_LABEL[tipRegion.charger_hint] : "-"],
          ]}
        />
      )}
      <MapLegend
        mode={mode}
        supplyMin={supplyMin}
        dots={dots.length > 0}
        hasOutside={paths.some(({ props }) => !byCd.has(props.adm_cd))}
      />
    </div>
  );
}

// 공급 단계 범례 문구
function supplyLabels(min: number) {
  const f = (n: number) => n.toFixed(1);
  return [`${f(min)}대 미만 (충분)`, `${f(min)}~${f(min * 2)}대`, `${f(min * 2)}~${f(min * 3)}대`, `${f(min * 3)}대 이상`];
}

interface MapLegendProps {
  mode: MapMode;
  supplyMin?: number;
  dots: boolean;
  hasOutside: boolean;
}

function MapLegend({ mode, supplyMin = 1, dots, hasOutside }: MapLegendProps) {
  return (
    <div className="legend" style={{ marginTop: 8 }}>
      {mode === "supply" ? (
        supplyLabels(supplyMin).map((l, i) => (
          <span key={l}>
            <i className="swatch" style={{ background: `var(--sup-${i})` }} />
            {l}
          </span>
        ))
      ) : mode === "class" ? (
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
      {dots && (
        <>
          <span>
            <i className="dot fast" />
            급속 있는 충전소
          </span>
          <span>
            <i className="dot slow" />
            완속만
          </span>
        </>
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
