// 파이프라인 실행: 수집 현황·DAG 실행 이력
import { DAG_LABEL, STATUS_LABEL, fmtDateTime, fmtInt, fmtMonth, type AppData } from "../data";
import { CardHead, PageHead } from "../components/PageHead";

// 결과별 표시 색 (성공·생략·주의)
const STATUS_TONE: Record<string, string> = {
  success: "ok",
  published: "ok",
  skipped_unchanged: "skip",
  unchanged: "skip",
  partial: "warn",
  held: "warn",
  failed: "bad",
};

export function Pipeline({ data }: { data: AppData }) {
  const { meta } = data;
  const dags = [...new Set(meta.pipeline.map((p) => p.dag_id))];
  const totalRuns = meta.pipeline.reduce((s, p) => s + p.runs, 0);

  return (
    <div className="page">
      <PageHead
        tags={["데이터 운영", "ops.pipeline_run"]}
        title="파이프라인 실행"
        lede="Airflow DAG 실행 결과와 도로 수집 현황입니다. 결과가 성공이어도 데이터가 부족하면 일부 수집·게시 보류로 따로 기록합니다."
      />

      <section className="stats" aria-label="수집 현황">
        <div className="stat">
          <div className="stat-value">{fmtInt(meta.poll.batches)}회</div>
          <div className="stat-label">도로 수집 회차 (30분 간격)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{meta.poll.ok_ratio}%</div>
          <div className="stat-label">수집 정상 응답률</div>
        </div>
        <div className="stat">
          <div className="stat-value">{meta.reg_months.length}개월</div>
          <div className="stat-label">
            등록 이력 {fmtMonth(meta.reg_months[0])} ~ {fmtMonth(meta.reg_months[meta.reg_months.length - 1])}
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{totalRuns}회</div>
          <div className="stat-label">DAG 실행 기록</div>
        </div>
      </section>

      <section className="card">
        <CardHead title="DAG별 실행 결과" sub={`수집 ${fmtDateTime(meta.poll.first_at)} ~ ${fmtDateTime(meta.poll.last_at)}`} />
        <div className="dag-grid">
          {dags.map((dag) => {
            const rows = meta.pipeline.filter((p) => p.dag_id === dag);
            const last = rows.map((r) => r.last_finished_at).filter(Boolean).sort().pop();
            return (
              <div key={dag} className="dag">
                <div className="dag-head">
                  <b>{DAG_LABEL[dag] ?? dag}</b>
                  <code>{dag}</code>
                </div>
                <div className="badges">
                  {rows.map((r) => (
                    <span key={r.status} className={`badge tone-${STATUS_TONE[r.status] ?? "skip"}`}>
                      {STATUS_LABEL[r.status] ?? r.status} {r.runs}
                    </span>
                  ))}
                </div>
                {last && <span className="metric-note">마지막 종료 {fmtDateTime(last)}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
