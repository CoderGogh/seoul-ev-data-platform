// 도로 여건: 분포·우선 검토 저속 비중·시간대 속도·링크별 타일
import { useMemo } from "react";
import { HINT_LABEL, HINT_ORDER, fmtDateTime, type AppData } from "../data";
import { hintCounts, linkTiles, timebandAverage } from "../insights";
import { navigate } from "../router";
import { CardHead, PageHead } from "../components/PageHead";
import { LowSpeedBars, TimebandBars } from "../components/charts";

export function Road({ data }: { data: AppData }) {
  const { regions, meta } = data;
  const p = meta.threshold.params;
  const hints = hintCounts(regions);
  const avg = useMemo(() => timebandAverage(data), [data]);
  const priority = regions.filter((r) => r.classification === "A");
  const groups = useMemo(
    () => (data.links ? linkTiles(data.links, regions, p.hint_fast_max_low, p.hint_slow_min_low) : []),
    [data.links, regions, p.hint_fast_max_low, p.hint_slow_min_low],
  );
  const linkTotal = groups.reduce((s, g) => s + g.tiles.length, 0);
  const maxHours = Math.max(0, ...(data.links?.links.map((l) => l[3]) ?? []));

  return (
    <div className="page">
      <PageHead
        tags={["지표 분석"]}
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
        <section className="card card-body">
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

        <section className="card card-body">
          <CardHead title="시간대별 평균 속도" sub={`${regions.length}개 동 평균, km/h (확정된 주간 시간대)`} />
          <TimebandBars data={avg} height={360} />
        </section>
      </div>

      {data.links && groups.length > 0 && (
        <section className="card card-body">
          <CardHead
            title="링크별 도로 여건"
            sub={`수집 대상 ${linkTotal}개 링크, ${fmtDateTime(data.links.window.start)} ~ ${fmtDateTime(data.links.window.end)} 주간 확정 관측 · 칸을 누르면 해당 동`}
            action={
              <div className="legend">
                {HINT_ORDER.map((h) => (
                  <span key={h}>
                    <i className="swatch" style={{ background: `var(--hint-${h})` }} />
                    {HINT_LABEL[h]}
                  </span>
                ))}
                <span>
                  <i className="swatch link-tile-none" />
                  관측 없음
                </span>
              </div>
            }
          />
          {groups.map((g) => (
            <div className="link-group" key={g.sgg}>
              <div className="link-group-head">
                <b>{g.sgg}</b>
                <span className="metric-note">
                  {HINT_ORDER.map((h) => `${HINT_LABEL[h]} ${g.counts[h]}`).join(" · ")}
                  {g.counts.none > 0 && ` · 관측 없음 ${g.counts.none}`}
                </span>
              </div>
              <div className="link-tiles" aria-hidden="true">
                {g.tiles.map((t) => (
                  <span
                    key={t.id}
                    className={`link-tile ${t.hint ? "" : "link-tile-none"}`}
                    style={t.hint ? { background: `var(--hint-${t.hint})` } : undefined}
                    title={`${t.adm_nm} · 링크 ${t.id} · ${t.low == null ? "관측 없음" : `저속 ${t.low}% (${t.n}시간)`}`}
                    onClick={() => navigate(`/regions/${t.adm_cd}`)}
                  />
                ))}
              </div>
            </div>
          ))}
          {maxHours > 0 && maxHours < 20 && (
            <p className="metric-note">
              링크당 관측이 최대 {maxHours}시간이라 비중이 {Math.round(1000 / maxHours) / 10}% 단위로 끊겨 보통 구간이 거의 나오지 않습니다.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
