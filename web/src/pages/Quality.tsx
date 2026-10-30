// 데이터 품질: 게시 상태·관문·수집 현황·실행 이력
import { DAG_LABEL, STATUS_LABEL, fmtDateTime, fmtInt, fmtMonth, type AppData } from "../data";

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

export function Quality({ data }: { data: AppData }) {
  const { meta, regions } = data;
  const grades = regions.reduce<Record<string, number>>((acc, r) => {
    acc[r.quality_grade] = (acc[r.quality_grade] ?? 0) + 1;
    return acc;
  }, {});

  // DAG별 상태 묶기
  const dags = [...new Set(meta.pipeline.map((p) => p.dag_id))];

  return (
    <div className="page">
      <section>
        <div className="kicker">기준월 {fmtMonth(meta.base_month)}</div>
        <h1>데이터 품질</h1>
        <p className="lede">
          수집·실행·지역 3단계 관문을 통과한 결과만 공개합니다. 수집은 2026년 10월 28일 과제 제출 후 중단해서 이 화면은 그
          시점 스냅샷입니다.
        </p>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>게시 상태</h2>
          <dl className="kv">
            <dt>상태</dt>
            <dd>
              <span className="check">✓</span> {meta.publish_status === "current" ? "최신 (current)" : meta.publish_status}
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
          <h2 style={{ marginBottom: 12 }}>수집 현황</h2>
          <dl className="kv">
            <dt>수집 회차</dt>
            <dd>{fmtInt(meta.poll.batches)}회 (30분 간격)</dd>
            <dt>기간</dt>
            <dd>
              {fmtDateTime(meta.poll.first_at)} ~ {fmtDateTime(meta.poll.last_at)}
            </dd>
            <dt>정상 응답률</dt>
            <dd>{meta.poll.ok_ratio}%</dd>
            <dt>등록 이력</dt>
            <dd>
              {fmtMonth(meta.reg_months[0])} ~ {fmtMonth(meta.reg_months[meta.reg_months.length - 1])} ({meta.reg_months.length}
              개월)
            </dd>
            <dt>지역 품질 등급</dt>
            <dd>
              정상 {grades.ok ?? 0} · 경고 {grades.warn ?? 0} · 미달 {grades.below ?? 0} · 치명 {grades.fatal ?? 0}
            </dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>품질 관문</h2>
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
          <div className="card-head">
            <h2>DAG 실행 이력</h2>
            <span className="card-sub">ops.pipeline_run</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DAG</th>
                  <th>결과</th>
                  <th className="num">횟수</th>
                </tr>
              </thead>
              <tbody>
                {dags.map((dag) =>
                  meta.pipeline
                    .filter((p) => p.dag_id === dag)
                    .map((p, i) => (
                      <tr key={`${p.dag_id}-${p.status}`}>
                        <td>{i === 0 ? DAG_LABEL[dag] ?? dag : ""}</td>
                        <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                        <td className="num">{p.runs}</td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>임계값</h2>
            <span className="card-sub">
              {meta.threshold.ver} · {meta.threshold.basis === "provisional" ? "잠정" : meta.threshold.basis}
            </span>
          </div>
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
    </div>
  );
}
