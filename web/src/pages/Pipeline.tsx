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
        lede="Airflow DAG 실행 결과와 수집 현황입니다. 결과가 성공이어도 데이터가 부족하면 일부 수집·게시 보류로 따로 기록합니다. 도로 수집은 10월 28일 제출 뒤 멈춘 상태입니다."
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

      <section className="card card-body">
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

      <div className="grid-2">
        <section className="card card-body">
          <CardHead title="웹 데이터 게시 (ev14)" sub="게시·공급 변경 시, 매일 07:10 · web-data 브랜치" />
          <dl className="kv">
            <dt>지금 화면 데이터</dt>
            <dd>{data.source.kind === "remote" ? "데이터 브랜치 (자동 게시)" : "배포 스냅샷 (대체)"}</dd>
            {data.source.sha && (
              <>
                <dt>커밋</dt>
                <dd>
                  <a href={`https://github.com/CoderGogh/seoul-ev-data-platform/commit/${data.source.sha}`} target="_blank" rel="noreferrer">
                    {data.source.sha.slice(0, 7)}
                  </a>
                </dd>
              </>
            )}
            {data.source.committed_at && (
              <>
                <dt>게시 시각</dt>
                <dd>{fmtDateTime(data.source.committed_at)}</dd>
              </>
            )}
            {data.source.reason && (
              <>
                <dt>대체 사유</dt>
                <dd>{data.source.reason}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card card-body">
          <CardHead title="자동 검사" sub="PR마다 통과해야 main 병합" />
          <dl className="kv">
            <dt>CI 4단계</dt>
            <dd>lint → test → validate_dag → validate_ddl</dd>
            <dt>단위 테스트</dt>
            <dd>Hook 응답·오류(인증키 미포함), SQL 분리, DAG 운영 정책</dd>
            <dt>DB 통합 테스트</dt>
            <dd>빈 PostGIS에 DDL 적용 후 실제 SQL 실행 (ev02 적재, ev03 게시·보류·롤백, ev04 이력)</dd>
            <dt>비밀값</dt>
            <dd>커밋 전 스테이징 변경 검사, Task 로그 인증키 가림</dd>
          </dl>
        </section>

        <section className="card card-body">
          <CardHead title="충전기 수집 첫 실행" sub="2026년 11월 2일 · 스케줄러 없이 1회 실행 3번" />
          <ul className="todos">
            <li className="todo done">
              <span className="badge tone-ok">성공</span>
              <span className="todo-title">1차: 3개 구 17,173건 수집 → 16,891대 신규 적재</span>
            </li>
            <li className="todo done">
              <span className="badge tone-ok">회복</span>
              <span className="todo-title">송파구 첫 요청 504 → 재시도로 통과 (오류 기록에 인증키 없음)</span>
            </li>
            <li className="todo done">
              <span className="badge tone-ok">멱등</span>
              <span className="todo-title">2·3차: 같은 날 다시 실행해도 이력 16,891건 그대로 (중복 없음)</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
