// 지도: 필터·색상 기준 전환
import { useMemo, useState } from "react";
import type { AppData } from "../data";
import { CardHead, PageHead } from "../components/PageHead";
import { Chip, RegionFilterBar, useRegionFilters } from "../components/RegionFilters";
import { RegionMap, type MapMode } from "../components/RegionMap";
import { navigate } from "../router";

export function MapPage({ data }: { data: AppData }) {
  const { regions, geo } = data;
  const f = useRegionFilters(regions);
  const [mode, setMode] = useState<MapMode>("class");
  const matches = useMemo(() => new Set(f.filtered.map((r) => r.adm_cd)), [f.filtered]);

  return (
    <div className="page">
      <PageHead tags={["지역 분석"]} title="지도" lede="조건으로 좁혀 보고, 동네를 누르면 검토 카드로 이동합니다." />

      <RegionFilterBar regions={regions} f={f} onHint={(h) => h !== "all" && setMode("hint")} />

      <section className="card">
        <CardHead
          title={`${f.filtered.length}곳 표시`}
          sub="조건에 맞는 동만 진하게"
          action={
            <div className="filter-row" aria-label="지도 색상 기준">
              <Chip on={mode === "class"} onClick={() => setMode("class")}>
                분류로 색칠
              </Chip>
              <Chip on={mode === "hint"} onClick={() => setMode("hint")}>
                도로 여건으로 색칠
              </Chip>
            </div>
          }
        />
        <RegionMap geo={geo} regions={regions} mode={mode} matches={matches} onSelect={(cd) => navigate(`/regions/${cd}`)} />
      </section>
    </div>
  );
}
