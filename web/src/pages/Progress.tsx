// 개발 진행: 로드맵 단계별 이슈 상태·최근 병합 (스냅샷 + GitHub 실시간 상태)
import { useEffect, useState } from "react";
import { fetchLiveIssues, fmtDate, loadProgress, type Progress, type ProgressIssue } from "../data";
import { CardHead, PageHead } from "../components/PageHead";

const AREA_LABEL: Record<string, string> = {
  "area:pipeline": "파이프라인",
  "area:analysis": "분석",
  "area:web": "웹",
  "area:infra": "인프라",
};

const PRIORITY_LABEL: Record<string, string> = {
  "priority:high": "높음",
  "priority:medium": "보통",
  "priority:low": "낮음",
};

function IssueRow({ no, issue }: { no: number; issue?: ProgressIssue }) {
  if (!issue) return null;
  const done = issue.state === "CLOSED";
  const area = issue.labels.find((l) => l.startsWith("area:"));
  const prio = issue.labels.find((l) => l.startsWith("priority:"));
  return (
    <li className={`todo${done ? " done" : ""}`}>
      <span className={`badge tone-${done ? "ok" : "skip"}`}>{done ? "완료" : "예정"}</span>
      <a href={issue.url} target="_blank" rel="noreferrer" className="todo-title">
        #{no} {issue.title}
      </a>
      <span className="todo-meta">
        {area && <span className="chip">{AREA_LABEL[area] ?? area}</span>}
        {!done && prio && <span className="metric-note">우선순위 {PRIORITY_LABEL[prio] ?? prio}</span>}
        {done && issue.closed_at && <span className="metric-note">{fmtDate(issue.closed_at)} 완료</span>}
      </span>
    </li>
  );
}

export function ProgressPage() {
  const [p, setP] = useState<Progress | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 스냅샷 먼저 표시, GitHub 최신 상태로 덮어쓰기
  useEffect(() => {
    loadProgress().then(
      async (snap) => {
        setP(snap);
        const issues = await fetchLiveIssues(snap.repo);
        if (issues) setP({ ...snap, issues: { ...snap.issues, ...issues } });
        setLive(Boolean(issues));
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  if (error) return <div className="empty">진행 현황을 불러오지 못했습니다. {error}</div>;
  if (!p) return <div className="empty">불러오는 중…</div>;

  const all = p.stages.flatMap((s) => s.issues);
  const done = all.filter((n) => p.issues[n]?.state === "CLOSED").length;
  const current = p.stages.find((s) => s.issues.some((n) => p.issues[n]?.state !== "CLOSED"));

  return (
    <div className="page">
      <PageHead
        tags={["데이터 운영", live ? "GitHub 실시간" : live === false ? "스냅샷 기준" : "확인 중"]}
        title="개발 진행"
        lede="10월 28일 과제 제출 뒤 서비스로 키우는 작업입니다. 로드맵 이슈를 단계 순서대로 진행하고, 기능마다 PR로 병합합니다."
      />

      <section className="stats" aria-label="진행 요약">
        <div className="stat">
          <div className="stat-value accent-num">
            {done} / {all.length}
          </div>
          <div className="stat-label">로드맵 과제 완료</div>
        </div>
        <div className="stat">
          <div className="stat-value">{current ? current.title.split(":")[0] : "완료"}</div>
          <div className="stat-label">{current ? current.title.split(":").slice(1).join(":").trim() : "모든 단계 완료"}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{p.merged.length}건</div>
          <div className="stat-label">병합 PR (최근 30건까지)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{p.merged[0] ? fmtDate(p.merged[0].merged_at) : "-"}</div>
          <div className="stat-label">마지막 병합 #{p.merged[0]?.number}</div>
        </div>
      </section>

      {p.stages.map((s) => {
        const n = s.issues.filter((no) => p.issues[no]?.state === "CLOSED").length;
        return (
          <section key={s.title} className="card card-body">
            <CardHead title={s.title} sub={`${n} / ${s.issues.length} 완료`} />
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${(100 * n) / s.issues.length}%` }} />
            </div>
            <ul className="todos">
              {s.issues.map((no) => (
                <IssueRow key={no} no={no} issue={p.issues[no]} />
              ))}
            </ul>
          </section>
        );
      })}

      <section className="card card-body">
        <CardHead
          title="최근 병합"
          sub="main 병합 시 이 화면도 자동 배포"
          action={
            <a className="more" href={p.roadmap.url} target="_blank" rel="noreferrer">
              로드맵 #{p.roadmap.number} →
            </a>
          }
        />
        <ul className="todos">
          {p.merged.slice(0, 10).map((m) => (
            <li key={m.number} className="todo done">
              <span className="metric-note">{fmtDate(m.merged_at)}</span>
              <a href={m.url} target="_blank" rel="noreferrer" className="todo-title">
                #{m.number} {m.title}
              </a>
              <span className="todo-meta">
                {m.closes.map((c) => (
                  <span key={c} className="chip">
                    #{c} 완료
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
