# GitHub Git Data API Hook: 데이터 브랜치에 여러 파일을 커밋 하나로 반영 (원자적, fast-forward 만)
# Connection: password=fine-grained 토큰 (대상 저장소 Contents 읽기·쓰기만), extra={"repo": "owner/name", "branch": "web-data"}
import hashlib
import json

import requests
from airflow.sdk import BaseHook
from airflow.sdk.log import mask_secret

API = "https://api.github.com"


# Git blob SHA (로컬 파일과 원격 트리 비교용)
def blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


# 바뀐 파일만 (원격 트리에 없거나 SHA 다름)
def changed_files(files: dict[str, bytes], remote: dict[str, str]) -> list[str]:
    return sorted(p for p, c in files.items() if remote.get(p) != blob_sha(c))


class GitHubDataHook(BaseHook):
    conn_name_attr = "conn_id"
    default_conn_name = "conn_github_web_data"
    hook_name = "GitHub data branch"

    def __init__(self, conn_id=default_conn_name, timeout=30, **kwargs):
        super().__init__(**kwargs)
        self.conn_id = conn_id
        self.timeout = timeout
        self._session = None
        self.repo = None
        self.branch = None

    def get_conn(self):
        if self._session is None:
            c = self.get_connection(self.conn_id)
            extra = c.extra_dejson
            self.repo, self.branch = extra["repo"], extra.get("branch", "web-data")
            mask_secret(c.password)  # Task 로그 가림
            s = requests.Session()
            s.headers.update({
                "Authorization": f"Bearer {c.password}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            })  # fmt: skip
            self._session = s
        return self._session

    # 호출 1회. 오류는 상태 코드·경로만 (응답 본문·헤더 미기록)
    def _req(self, method, path, body=None, ok=(200, 201)):
        s = self.get_conn()
        try:
            r = s.request(method, f"{API}/repos/{self.repo}/{path}", json=body, timeout=self.timeout)
        except requests.RequestException as e:
            raise RuntimeError(f"GitHub {method} {path} 호출 실패: {type(e).__name__}") from None
        if r.status_code not in ok:
            raise GitHubError(r.status_code, f"GitHub {method} {path} HTTP {r.status_code}")
        return r.json() if r.content else {}

    # 브랜치 최신 커밋 (없으면 None)
    def head(self):
        try:
            ref = self._req("GET", f"git/ref/heads/{self.branch}")
        except GitHubError as e:
            if e.status == 404:
                return None
            raise
        return ref["object"]["sha"]

    # 커밋 트리의 파일 경로 → blob SHA
    def tree(self, commit_sha):
        tree_sha = self._req("GET", f"git/commits/{commit_sha}")["tree"]["sha"]
        t = self._req("GET", f"git/trees/{tree_sha}?recursive=1")
        return {e["path"]: e["sha"] for e in t["tree"] if e["type"] == "blob"}

    # 파일 묶음을 커밋 하나로 반영. 바뀐 게 없으면 None, 브랜치 없으면 새로 만듦
    def commit_files(self, files: dict[str, bytes], message: str, expected_head=None):
        self.get_conn()
        head = self.head()
        if expected_head is not None and head != expected_head:
            raise GitHubError(409, "비교 이후 브랜치가 바뀜")
        remote = self.tree(head) if head else {}
        changed = changed_files(files, remote)
        if not changed:
            return None
        entries = []
        for path in changed:
            blob = self._req("POST", "git/blobs", {"content": files[path].decode("utf-8"), "encoding": "utf-8"})
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        base = {"base_tree": self._req("GET", f"git/commits/{head}")["tree"]["sha"]} if head else {}
        tree = self._req("POST", "git/trees", {**base, "tree": entries})
        commit = self._req(
            "POST", "git/commits", {"message": message, "tree": tree["sha"], "parents": [head] if head else []}
        )
        if head:  # fast-forward 만 (동시 갱신 시 422 → 재시도에서 다시 비교)
            self._req("PATCH", f"git/refs/heads/{self.branch}", {"sha": commit["sha"], "force": False})
        else:
            self._req("POST", "git/refs", {"ref": f"refs/heads/{self.branch}", "sha": commit["sha"]})
        return {"sha": commit["sha"], "changed": changed}


class GitHubError(RuntimeError):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def dumps(obj) -> bytes:
    # 웹 JSON 직렬화 (키 순서 유지, 공백 최소, 줄바꿈 끝)
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str) + "\n").encode("utf-8")
