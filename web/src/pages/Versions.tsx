// 데이터 버전 (운영 이상): 원천별 기준일·게시·데이터 커밋·웹 배포
import { useMemo } from "react";
import { fmtDate, fmtDateTime, fmtMonth, type AppData } from "../data";
import { freshness, summary, worst } from "../freshness";
import { buildInfo } from "../versions";
import { CardHead, PageHead } from "../components/PageHead";

const REPO = "https://github.com/CoderGogh/seoul-ev-data-platform";
const LEVEL_TEXT = { ok: "정상", warn: "주의", bad: "오래됨" } as const;

export function Versions({ data }: { data: AppData }) {
  const { meta, chargers, source } = data;
  const items = useMemo(() => freshness(meta, chargers), [meta, chargers]);
  const level = worst(items);
  const msg = summary(items);
  const build = buildInfo();

  return (
    <div className="page">
      <PageHead
        tags={["데이터 운영", `전체 ${LEVEL_TEXT[level]}`]}
        title="데이터 버전"
        lede="화면에 쓰인 데이터의 원천별 기준일, 게시 버전, 데이터·웹 배포 커밋입니다. 일반 화면에는 필요한 기준만 하단에 작게 표시합니다."
      />

      {msg && <p className={`fresh-alert fresh-${level}`}>{msg}</p>}

      <section className="card">
        <CardHead title="원천별 기준일" sub="화면을 연 시각 기준 경과" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>원천</th>
                <th>기준</th>
                <th>경과</th>
                <th>상태</th>
                <th>판정 규칙</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <td>
                    <b>{i.label}</b>
                  </td>
                  <td className="num">{i.value}</td>
                  <td className="num">{i.age}</td>
                  <td>
                    <span className={`badge tone-${i.level}`}>{LEVEL_TEXT[i.level]}</span>
                  </td>
                  <td className="metric-note">{i.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <CardHead title="게시 버전" sub="ev03 품질 관문 통과분" />
          <dl className="kv">
            <dt>분류 기준</dt>
            <dd>
              {meta.threshold.ver} · {meta.threshold.basis === "provisional" ? "잠정" : meta.threshold.basis}
            </dd>
            <dt>게시 상태</dt>
            <dd>{meta.publish_status === "current" ? "최신 게시" : meta.publish_status}</dd>
            <dt>게시 시각</dt>
            <dd>{fmtDateTime(meta.published_at)}</dd>
            <dt>등록 기준월</dt>
            <dd>
              {fmtMonth(meta.base_month)} (이력 {fmtMonth(meta.reg_months[0])} ~ {fmtMonth(meta.reg_months[meta.reg_months.length - 1])})
            </dd>
            <dt>도로 분석 기간</dt>
            <dd>
              {fmtDateTime(meta.traffic_window_start)} ~ {fmtDateTime(meta.traffic_window_end)}
            </dd>
            <dt>도로 수집</dt>
            <dd>
              {meta.poll.batches}회 · {fmtDateTime(meta.poll.first_at)} ~ {fmtDateTime(meta.poll.last_at)}
            </dd>
            {chargers && (
              <>
                <dt>충전기</dt>
                <dd>
                  {fmtDate(chargers.snapshot_date)} 수집 · {fmtDateTime(chargers.loaded_at)} 적재
                </dd>
              </>
            )}
            <dt>경계·링크</dt>
            <dd>
              {meta.boundary_ver} · {meta.link_ver}
            </dd>
          </dl>
        </section>

        <section className="card">
          <CardHead title="배포 버전" sub="데이터 커밋(ev14)과 웹 빌드" />
          <dl className="kv">
            <dt>데이터 출처</dt>
            <dd>{source.kind === "remote" ? "web-data 브랜치 (자동 게시)" : "배포 스냅샷 (대체)"}</dd>
            {source.sha && (
              <>
                <dt>데이터 커밋</dt>
                <dd>
                  <a href={`${REPO}/commit/${source.sha}`} target="_blank" rel="noreferrer">
                    {source.sha.slice(0, 7)}
                  </a>
                </dd>
              </>
            )}
            {source.committed_at && (
              <>
                <dt>데이터 게시</dt>
                <dd>{fmtDateTime(source.committed_at)}</dd>
              </>
            )}
            {source.reason && (
              <>
                <dt>대체 사유</dt>
                <dd>{source.reason}</dd>
              </>
            )}
            <dt>웹 커밋</dt>
            <dd>
              {build.sha === "local" ? (
                "로컬 빌드"
              ) : (
                <a href={`${REPO}/commit/${build.sha}`} target="_blank" rel="noreferrer">
                  {build.short}
                </a>
              )}
              {build.ref && ` · ${build.ref}`}
            </dd>
            <dt>웹 빌드</dt>
            <dd>
              {build.atText} · {build.env === "production" ? "운영" : build.env === "preview" ? "미리보기" : build.env}
            </dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
