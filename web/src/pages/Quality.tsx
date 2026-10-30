// 데이터 품질: 게시 상태·품질 관문·임계값
import { fmtDateTime, fmtMonth, type AppData } from "../data";
import { CardHead, PageHead } from "../components/PageHead";

const PARAM_LABEL: Record<string, string> = {
  a_min_ev_cnt: "우선 검토 최소 전기차 대수",
  a_min_yoy_rate: "우선 검토 최소 1년 증가율 (%)",
  min_link_cnt: "행정동 최소 링크 수",
  min_coverage: "최소 관측 커버리지 (%)",
  min_valid_timebands: "최소 유효 시간대 수",
  valid_tb_link_ratio: "유효 시간대 링크 비율",
  low_spd_kmh: "저속 기준 (km/h)",
  hint_fast_max_low: "원활 상한 저속 비중 (%)",
  hint_slow_min_low: "혼잡 하한 저속 비중 (%)",
};

const GRADE_LABEL: [string, string][] = [
  ["ok", "정상"],
  ["warn", "경고"],
  ["below", "기준 미달"],
  ["fatal", "치명"],
];

export function Quality({ data }: { data: AppData }) {
  const { meta, regions } = data;
  const grades = regions.reduce<Record<string, number>>((acc, r) => {
    acc[r.quality_grade] = (acc[r.quality_grade] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page">
      <PageHead
        tags={["데이터 운영", `기준월 ${fmtMonth(meta.base_month)}`]}
        title="데이터 품질"
        lede="수집·실행·지역 3단계 관문을 통과한 결과만 공개합니다. 수집은 2026년 10월 28일 과제 제출 후 중단해서 이 화면은 그 시점 스냅샷입니다."
      />

      <section className="card">
        <CardHead title="품질 관문" sub="하나라도 미달이면 공개하지 않거나 지역 분류를 낮춤" />
        <div className="gates">
          <div className="gate">
            <span className="gate-step">Gate 0 · 회차 / 기준월</span>
            <h3>수집 완결성</h3>
            <p>도로 수집 회차와 등록 스냅샷을 점검. 일부만 들어오면 partial, 치명이면 적재 차단</p>
          </div>
          <div className="gate">
            <span className="gate-step">Gate 1 · 기준월</span>
            <h3>실행 적격성</h3>
            <p>당월·전년 동월 등록, 도로 최신성, 커버리지 60% 이상, 활성 마스터, 주간 시간대 6개 이상. 하나라도 미달이면 게시 보류</p>
          </div>
          <div className="gate">
            <span className="gate-step">Gate 2 · 행정동</span>
            <h3>지역별 품질</h3>
            <p>링크 3개 미만·커버리지 미달은 데이터 보완 필요(C), 등록 없음·링크 0개는 판단 보류</p>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title="게시 상태" />
          <dl className="kv">
            <dt>상태</dt>
            <dd>
              <span className="pass">{meta.publish_status === "current" ? "최신 게시" : meta.publish_status}</span>
            </dd>
            <dt>게시 시각</dt>
            <dd>{fmtDateTime(meta.published_at)}</dd>
            <dt>등록 기준월</dt>
            <dd>{fmtMonth(meta.base_month)}</dd>
            <dt>도로 분석 기간</dt>
            <dd>
              {fmtDateTime(meta.traffic_window_start)} ~ {fmtDateTime(meta.traffic_window_end)}
            </dd>
            <dt>게시 행정동</dt>
            <dd>{meta.region_cnt}곳</dd>
            <dt>링크 마스터</dt>
            <dd>{meta.link_ver}</dd>
            <dt>경계 마스터</dt>
            <dd>{meta.boundary_ver}</dd>
          </dl>
          {meta.period_mismatch && (
            <p className="note" style={{ marginTop: 14 }}>
              등록 기준월과 도로 관측 기간이 다릅니다. 등록은 월 단위로 늦게 공개되고 도로는 실시간이라 MVP 에서는 예외로
              허용했습니다.
            </p>
          )}
        </section>

        <section className="card">
          <CardHead title="지역 품질 등급" sub={`${regions.length}개 동`} />
          <div className="hbars">
            {GRADE_LABEL.map(([k, label]) => (
              <div key={k} className="hbar">
                <span className="hbar-label">{label}</span>
                <span className="hbar-track">
                  <span
                    className="hbar-fill"
                    style={{ width: `${(100 * (grades[k] ?? 0)) / regions.length}%`, background: k === "ok" ? "var(--good)" : "var(--ref)" }}
                  />
                </span>
                <span className="hbar-num">{grades[k] ?? 0}곳</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <CardHead title="임계값" sub={`${meta.threshold.ver} · ${meta.threshold.basis === "provisional" ? "잠정" : meta.threshold.basis}`} />
        <div className="table-wrap">
          <table>
            <tbody>
              {Object.entries(PARAM_LABEL).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td className="num">{meta.threshold.params[k] ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
