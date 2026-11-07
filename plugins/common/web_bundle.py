# 웹 데이터 묶음: files/sqls/web/*.sql 실행 결과 → 검증 → 데이터 브랜치 파일 (web/*.json + manifest.json)
from common import db

REQUIRED = ("meta", "regions", "monthly", "timeband", "admdong", "chargers", "history")
MAX_BYTES = 2_000_000  # 파일당 상한 (웹 첫 로드 크기)


def names():
    return sorted(p.stem for p in (db.SQL_DIR / "web").glob("*.sql"))


# SQL 1개 = JSON 1개 (결과 첫 행 첫 열)
def export_all():
    out = {}
    for name in names():
        rows = db.execute_file(f"web/{name}.sql", fetch=True)
        out[name] = next(iter(rows[0].values())) if rows else None
    return out


# 게시 결과와 맞는지 검사. 문제 목록 반환 (빈 목록이면 통과)
def validate(bundle, sizes=None):
    problems = [f"{n}: 없음" for n in REQUIRED if bundle.get(n) is None]
    if problems:
        return problems
    meta, regions, chargers = bundle["meta"], bundle["regions"], bundle["chargers"]
    if meta.get("publish_status") != "current":
        problems.append(f"meta: 게시 상태 {meta.get('publish_status')}")
    if len(regions) != meta.get("region_cnt"):
        problems.append(f"regions: {len(regions)}행 != 게시 {meta.get('region_cnt')}곳")
    if len({r["adm_cd"] for r in regions}) != len(regions):
        problems.append("regions: 행정동 중복")
    if not (meta.get("threshold") or {}).get("ver"):
        problems.append("meta: 활성 임계값 없음")
    if len(chargers.get("by_dong") or []) != len(regions):
        problems.append(f"chargers: 동 {len(chargers.get('by_dong') or [])}곳 != {len(regions)}곳")
    if not bundle["history"].get("publishes"):
        problems.append("history: 게시 이력 없음")
    region_cds = {r["adm_cd"] for r in regions}
    # 월별 추세: 링크 있는 동은 필수 (링크 0개 동은 판단 보류로 게시만)
    no_series = {r["adm_cd"] for r in regions if r.get("link_cnt", 1) > 0} - set(bundle["monthly"])
    if no_series:
        problems.append(f"monthly: 게시 행정동 {len(no_series)}곳 누락")
    # 지도: 게시 동은 모두 경계 있음, 대상 표시 경계는 모두 게시 동
    props = [f["properties"] for f in bundle["admdong"].get("features", [])]
    if not region_cds <= {p["adm_cd"] for p in props}:
        problems.append("admdong: 게시 행정동 경계 누락")
    if not {p["adm_cd"] for p in props if p.get("is_target")} <= region_cds:
        problems.append("admdong: 미게시 행정동이 대상으로 표시")
    for n, size in (sizes or {}).items():
        if size > MAX_BYTES:
            problems.append(f"{n}: {size} bytes > {MAX_BYTES}")
    return problems


def manifest(bundle, file_shas, run_id, exported_at):
    meta = bundle["meta"]
    return {
        "exported_at": exported_at,
        "run_id": run_id,
        "base_month": meta["base_month"],
        "threshold_ver": meta["threshold"]["ver"],
        "published_at": meta["published_at"],
        "charger_snapshot": bundle["chargers"].get("snapshot_date"),
        "files": file_shas,
    }
