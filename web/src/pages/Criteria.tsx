// 판정 기준: 산점도·분류 규칙·기준 근접 동
import { CLASS_LABEL, fmtInt, fmtPct, type AppData } from "../data";
import { nearMiss } from "../insights";
import { CardHead, PageHead } from "../components/PageHead";
import { CriteriaScatter } from "../components/charts";
import { navigate } from "../router";

export function Criteria({ data }: { data: AppData }) {
  const { regions, meta } = data;
  const p = meta.threshold.params;
  const near = nearMiss(regions, p.a_min_ev_cnt, p.a_min_yoy_rate);
  const evOnly = regions.filter((r) => r.classification !== "A" && r.ev_cnt >= p.a_min_ev_cnt).length;
  const yoyOnly = regions.filter((r) => r.classification !== "A" && (r.ev_yoy_rate ?? -Infinity) >= p.a_min_yoy_rate).length;

  return (
    <div className="page">
      <PageHead
        tags={["지표 분석", `임계값 ${meta.threshold.ver} · 잠정`]}
        title="판정 기준"
        lede={`전기차 ${fmtInt(p.a_min_ev_cnt)}대 이상, 1년 증가율 ${p.a_min_yoy_rate}% 이상을 모두 넘으면 우선 검토입니다. 두 값은 67개 동 상위 40% 경계입니다.`}
      />

      <section className="card">
        <CardHead
          title="전기차 대수 × 1년 증가율"
          sub="오른쪽 위 칸이 우선 검토. 점을 누르면 검토 카드로 이동"
          action={
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: "var(--accent)", borderRadius: 999 }} />
                {CLASS_LABEL.A}
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--ref)", borderRadius: 999 }} />
                {CLASS_LABEL.REF}
              </span>
              <span>
                <i className="swatch-line" />
                기준선
              </span>
            </div>
          }
        />
        <CriteriaScatter regions={regions} minEv={p.a_min_ev_cnt} minYoy={p.a_min_yoy_rate} height={420} />
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title="기준 근접" sub="기준 하나는 넘고 다른 하나도 80% 이상 도달" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>행정동</th>
                  <th className="num">전기차</th>
                  <th className="num">1년 증가율</th>
                  <th>부족분</th>
                </tr>
              </thead>
              <tbody>
                {near.map(({ region: r, short }) => (
                  <tr key={r.adm_cd} className="clickable" onClick={() => navigate(`/regions/${r.adm_cd}`)}>
                    <td>
                      <b>{r.adm_nm}</b> <span className="metric-note">{r.sgg_nm}</span>
                    </td>
                    <td className="num">{fmtInt(r.ev_cnt)}</td>
                    <td className="num">{fmtPct(r.ev_yoy_rate)}</td>
                    <td>{short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="metric-note" style={{ marginTop: 12 }}>
            관찰 대상 중 전기차 기준만 넘은 동 {evOnly}곳, 증가율 기준만 넘은 동 {yoyOnly}곳
          </p>
        </section>

        <section className="card">
          <CardHead title="분류 규칙" sub="품질 등급을 먼저 보고 수요를 판정" />
          <div className="table-wrap">
            <table className="wrap-cells">
              <thead>
                <tr>
                  <th>품질 등급</th>
                  <th>조건</th>
                  <th>분류</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>치명</td>
                  <td>등록 없음, 귀속 링크 0개</td>
                  <td>{CLASS_LABEL.WITHHELD}</td>
                </tr>
                <tr>
                  <td>기준 미달</td>
                  <td>링크 3개·커버리지 60%·시간대 6개 미만</td>
                  <td>{CLASS_LABEL.C}</td>
                </tr>
                <tr>
                  <td>경고</td>
                  <td>전년 동월 등록 없음</td>
                  <td>증가율 없어 우선 검토 제외</td>
                </tr>
                <tr>
                  <td>정상</td>
                  <td>두 기준 모두 충족</td>
                  <td>
                    <b>{CLASS_LABEL.A}</b>, 그 외 {CLASS_LABEL.REF}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="metric-note" style={{ marginTop: 12 }}>
            이번 기준월은 67개 동 모두 정상 등급
          </p>
        </section>
      </div>
    </div>
  );
}
