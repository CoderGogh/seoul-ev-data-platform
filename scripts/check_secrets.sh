#!/bin/bash
# 스테이징 변경의 .env 비밀값 검사 (KEY·PASSWORD·SECRET·TOKEN·WEBHOOK, URL 인코딩형 포함). 발견 시 종료 코드 1
# pre-commit 훅으로 쓰려면: ln -s ../../scripts/check_secrets.sh .git/hooks/pre-commit
ROOT="$(git rev-parse --show-toplevel)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || exit 0
git diff --cached -U0 --no-color | grep '^+' | grep -v '^+++' | python3 -c '
import re, sys
from urllib.parse import quote, unquote
text = sys.stdin.read()
found = []
for line in open(sys.argv[1], encoding="utf-8"):
    if "=" not in line or line.lstrip().startswith("#"):
        continue
    k, v = line.split("=", 1)
    v = v.strip().strip("\"").strip("'\''")
    if re.search(r"KEY|PASSWORD|SECRET|TOKEN|WEBHOOK", k) and len(v) >= 6:
        if any(s in text for s in {v, unquote(v), quote(v, safe=""), quote(unquote(v), safe="")}):
            found.append(k)
if found:
    sys.exit("커밋 차단: .env 비밀값 포함 → " + ", ".join(found))
' "$ENV_FILE"
