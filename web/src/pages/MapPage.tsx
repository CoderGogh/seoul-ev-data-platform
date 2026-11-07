// 지도: 필터·색상 기준 전환, 충전소 점 레이어
import { useMemo, useState } from "react";
import type { AppData } from "../data";
import { CardHead, PageHead } from "../components/PageHead";
import { Chip, RegionFilterBar, useRegionFilters } from "../components/RegionFilters";
import { RegionMap, type MapMode, type MapPoint } from "../components/RegionMap";
import { navigate } from "../router";

type DotFilter = "off" | "all" | "fast" | "slow";

const DOT_LABEL: Record<DotFilter, string> = { off: "끄기", all: "전체", fast: "급속 있는 곳", slow: "완속만" };

// 충전소 점: 급속 1대 이상이면 급속 충전소
export function stationPoints(stations: [number, number, number, number][] | undefined, filter: DotFilter): MapPoint[] {
  if (!stations || filter === "off") return [];
  return stations
    .map(([lng, lat, , fast]) => ({ lng, lat, fast: fast > 0 }))
    .filter((p) => filter === "all" || (filter === "fast") === p.fast);
}

export function MapPage({ data }: { data: AppData }) {
  const { regions, geo } = data;
  const f = useRegionFilters(regions);
  const [mode, setMode] = useState<MapMode>("class");
  const [dot, setDot] = useState<DotFilter>("off");
  const matches = useMemo(() => new Set(f.filtered.map((r) => r.adm_cd)), [f.filtered]);
  const stations = data.chargers?.stations;
  const points = useMemo(() => stationPoints(stations, dot), [stations, dot]);
  const supplyMin = data.meta.threshold.params.a_min_ev_per_charger;

  return (
    <div className="page">
      <PageHead tags={["지역 분석"]} title="지도" lede="조건으로 좁혀 보고, 동네를 누르면 검토 카드로 이동합니다." />

      <RegionFilterBar regions={regions} f={f} onHint={(h) => h !== "all" && setMode("hint")} />

      <section className="card">
        <CardHead
          title={`${f.filtered.length}곳 표시`}
          sub={mode === "supply" ? "충전기 1대당 전기차, 진할수록 공급 부족" : "조건에 맞는 동만 진하게"}
          action={
            <div className="filter-row" aria-label="지도 색상 기준">
              <Chip on={mode === "class"} onClick={() => setMode("class")}>
                분류로 색칠
              </Chip>
              <Chip on={mode === "hint"} onClick={() => setMode("hint")}>
                도로 여건으로 색칠
              </Chip>
              {supplyMin != null && (
                <Chip on={mode === "supply"} onClick={() => setMode("supply")}>
                  충전기 공급으로 색칠
                </Chip>
              )}
            </div>
          }
        />
        {stations && (
          <div className="filter-row" aria-label="충전소 점" style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              충전소 점
            </span>
            {(Object.keys(DOT_LABEL) as DotFilter[]).map((k) => (
              <Chip key={k} on={dot === k} onClick={() => setDot(k)}>
                {DOT_LABEL[k]}
              </Chip>
            ))}
          </div>
        )}
        <RegionMap
          geo={geo}
          regions={regions}
          mode={mode}
          matches={matches}
          supplyMin={supplyMin}
          points={points}
          onSelect={(cd) => navigate(`/regions/${cd}`)}
        />
      </section>
    </div>
  );
}
