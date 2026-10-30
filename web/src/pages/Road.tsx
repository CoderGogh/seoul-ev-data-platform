// 도로 여건: 분포·우선 검토 저속 비중·시간대 속도
import { useMemo } from "react";
import { HINT_LABEL, fmtDateTime, type AppData } from "../data";
import { hintCounts, timebandAverage } from "../insights";
import { CardHead, PageHead } from "../components/PageHead";
import { LowSpeedBars, TimebandBars } from "../components/charts";

export function Road({ data }: { data: AppData }) {
  const { regions, meta } = data;
  const p = meta.threshold.params;
  const hints = hintCounts(regions);
  const avg = useMemo(() => timebandAverage(data), [data]);
  const priority = regions.filter((r) => r.classification === "A");

  return (
    <div className="page">
      <PageHead
        tags={["지표 분석", `도로 ${fmtDateTime(meta.traffic_window_start)} ~ ${fmtDateTime(meta.traffic_window_end)}`]}
        title="도로 여건"
        lede={`${p.low_spd_kmh}km/h 미만으로 달린 링크·시간 비중입니다. ${p.hint_fast_max_low}% 미만 원활, ${p.hint_slow_min_low}% 이상 혼잡. 모든 차량 기준이라 수요 판정에는 쓰지 않고, 현장 조사 포인트로만 씁니다.`}
      />

      <section className="stats" aria-label="도로 여건 분포">
        {hints.map((h) => (
          <div className="stat" key={h.hint} style={{ borderTop: `4px solid var(--hint-${h.hint})` }}>
            <div className="stat-value">{h.all}곳</div>
            <div className="stat-label">
              {HINT_LABEL[h.hint]} · 우선 검토 {h.priority}곳
            </div>
          </div>
        ))}
        <div className="stat">
          <div className="stat-value">{regions.length}곳</div>
          <div className="stat-label">전체 행정동</div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead
            title="우선 검토 지역 저속 비중"
            sub="점선은 13%·22% 경계, 막대를 누르면 검토 카드"
            action={
              <div className="legend">
                {hints.map((h) => (
                  <span key={h.hint}>
                    <i className="swatch" style={{ background: `var(--hint-${h.hint})` }} />
                    {HINT_LABEL[h.hint]}
                  </span>
                ))}
              </div>
            }
          />
          <LowSpeedBars regions={priority} fastMax={p.hint_fast_max_low} slowMin={p.hint_slow_min_low} height={360} />
        </section>

        <section className="card">
          <CardHead title="시간대별 평균 속도" sub={`${regions.length}개 동 평균, km/h (확정된 주간 시간대)`} />
          <TimebandBars data={avg} height={360} />
        </section>
      </div>
    </div>
  );
}
