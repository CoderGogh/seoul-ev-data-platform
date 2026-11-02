"""웹 진행 현황 데이터 내보내기 (GitHub 로드맵 이슈·병합 PR → web/public/data/progress.json)

로드맵 이슈 본문의 단계(## 제목)·체크 항목(#번호) 순서를 그대로 사용. gh CLI 로그인 필요
사용: python3 scripts/export_progress.py [로드맵 이슈 번호]
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "progress.json"


def gh(*args):
    return json.loads(subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout)


# 로드맵 본문 → 단계별 이슈 번호
def parse_roadmap(body):
    stages, cur = [], None
    for line in body.splitlines():
        if line.startswith("## ") and "선행" not in line:
            cur = {"title": line[3:].strip(), "issues": []}
            stages.append(cur)
        elif cur is not None and (m := re.match(r"- \[[ x]\] #(\d+)", line.strip())):
            cur["issues"].append(int(m.group(1)))
    return stages


def issue_row(i):
    labels = [lb["name"] for lb in i["labels"]]
    return {"title": i["title"], "state": i["state"], "closed_at": i["closedAt"], "url": i["url"], "labels": labels}


def pr_row(p):
    closes = [c["number"] for c in p["closingIssuesReferences"]]
    return {"number": p["number"], "title": p["title"], "merged_at": p["mergedAt"], "url": p["url"], "closes": closes}


def main(roadmap_no):
    repo = gh("repo", "view", "--json", "nameWithOwner")["nameWithOwner"]
    roadmap = gh("issue", "view", str(roadmap_no), "--json", "number,title,body,url")
    issues = gh("issue", "list", "--state", "all", "--limit", "200", "--json", "number,title,state,labels,closedAt,url")
    prs = gh(
        "pr",
        "list",
        "--state",
        "merged",
        "--limit",
        "30",
        "--json",
        "number,title,mergedAt,url,closingIssuesReferences",
    )
    data = {
        "repo": repo,
        "roadmap": {"number": roadmap["number"], "title": roadmap["title"], "url": roadmap["url"]},
        "stages": parse_roadmap(roadmap["body"]),
        "issues": {str(i["number"]): issue_row(i) for i in issues},
        "merged": [pr_row(p) for p in sorted(prs, key=lambda p: p["mergedAt"], reverse=True)],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(
        f"내보냄: {OUT.relative_to(ROOT)} (단계 {len(data['stages'])}, 이슈 {len(data['issues'])}, PR {len(data['merged'])})"
    )


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 57)
