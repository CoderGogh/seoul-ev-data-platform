// 게시 이력: 게시별 우선 검토(A) 변화 + 재처리 요청 이력
import { useMemo } from "react";
import { fmtDateTime, fmtMonth, type AppData } from "../data";
import { CardHead, PageHead } from "../components/PageHead";
import { Link } from "../router";
import { publishDiffs } from "../history";

const SCOPE_LABEL = { registration: "등록", timeband: "시간대", mart: "마트" } as const;
const REQ_STATUS = { requested: "요청", running: "진행 중", done: "완료", failed: "실패" } as const;

export function History({ data }: { data: AppData }) {
  const h = data.history;
  // 동 이름: 현재 게시 + 경계 (빠진 동도 이름 표시)
  const names = useMemo(() => {
    const m = new Map(data.geo.features.map((f) => [f.properties.adm_cd, f.properties.adm_nm]));
    data.regions.forEach((r) => m.set(r.adm_cd, r.adm_nm));
    return m;
  }, [data]);
  const diffs = useMemo(() => publishDiffs(h?.publishes ?? []), [h]);

  if (!h) {
    return (
      <div className="page">
        <PageHead tags={["데이터 운영"]} title="게시 이력" />
        <div className="empty">게시 이력 데이터가 아직 없습니다. 다음 웹 데이터 게시(ev14)부터 표시됩니다.</div>
      </div>
    );
  }

  const name = (cd: string) => (
    <Link key={cd} to={`/regions/${cd}`} className="chip">
      {names.get(cd) ?? cd}
    </Link>
  );

  return (
    <div className="page">
      <PageHead tags={["데이터 운영"]} title="게시 이력" lede="게시마다 우선 검토 지역이 어떻게 바뀌었는지와 재처리 요청을 봅니다." />

      <section className="card card-body">
        <CardHead title={`게시 ${diffs.length}회`} sub="최신순, 직전 게시 대비 우선 검토 추가·제외" />
        <div className="table-wrap">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>게시 시각</th>
                <th>기준월</th>
                <th>임계값</th>
                <th className="num">우선 검토</th>
                <th>변화</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map(({ entry: e, added, removed, comparable }) => (
                <tr key={`${e.base_month}-${e.run_id}`}>
                  <td>
                    {fmtDateTime(e.published_at)}
                    {e.request_id != null && <span className="badge">재처리 #{e.request_id}</span>}
                  </td>
                  <td>{fmtMonth(e.base_month)}</td>
                  <td>{e.threshold_ver}</td>
                  <td className="num">{e.a_list ? `${e.a_list.length}곳` : "-"}</td>
                  <td className="history-diff">
                    {!e.a_list ? (
                      <span className="muted">목록 기록 전 게시</span>
                    ) : !comparable ? (
                      <span className="muted">비교 기준 없음</span>
                    ) : added.length + removed.length === 0 ? (
                      <span className="muted">변화 없음</span>
                    ) : (
                      <>
                        {added.length > 0 && <div>추가 {added.map(name)}</div>}
                        {removed.length > 0 && <div>제외 {removed.map(name)}</div>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-body">
        <CardHead title={`재처리 요청 ${h.reprocess.length}건`} sub="ev11 요청 (요청자 비공개)" />
        {h.reprocess.length === 0 ? (
          <div className="empty">요청 없음</div>
        ) : (
          <div className="table-wrap">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>#</th>
                  <th>범위</th>
                  <th>대상</th>
                  <th>사유</th>
                  <th>상태</th>
                  <th>요청 시각</th>
                </tr>
              </thead>
              <tbody>
                {[...h.reprocess].reverse().map((r) => (
                  <tr key={r.request_id}>
                    <td>{r.request_id}</td>
                    <td>
                      {SCOPE_LABEL[r.scope]}
                      {r.force && <span className="badge">강제</span>}
                    </td>
                    <td>
                      {r.base_months?.map(fmtMonth).join(", ") ??
                        (r.date_from ? `${r.date_from} ~ ${r.date_to ?? ""}` : "-")}
                    </td>
                    <td>{r.reason}</td>
                    <td>{REQ_STATUS[r.status]}</td>
                    <td>{fmtDateTime(r.requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
