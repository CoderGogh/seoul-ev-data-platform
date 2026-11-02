# ev14 웹 데이터 게시: blob SHA·변경 판정·원자 커밋 흐름·검증 (GitHub 호출 없음)
import subprocess

import pytest
from hooks import github_data_hook as g


# git hash-object 와 같은 blob SHA
def test_blob_sha_matches_git(tmp_path):
    f = tmp_path / "a.json"
    f.write_bytes(g.dumps({"한글": 1}))
    out = subprocess.run(["git", "hash-object", str(f)], capture_output=True, text=True, check=True).stdout.strip()
    assert g.blob_sha(f.read_bytes()) == out


def test_changed_files():
    files = {"web/a.json": b"1\n", "web/b.json": b"2\n"}
    remote = {"web/a.json": g.blob_sha(b"1\n"), "web/b.json": "old", "manifest.json": "x"}
    assert g.changed_files(files, remote) == ["web/b.json"]
    assert g.changed_files(files, {}) == ["web/a.json", "web/b.json"]


class _Res:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body
        self.content = b"x" if body is not None else b""

    def json(self):
        return self._body


# 가짜 GitHub: 브랜치 1개, 요청 기록
class _FakeGitHub:
    def __init__(self, head=None, tree=None):
        self.head, self.tree, self.calls = head, tree or {}, []

    def request(self, method, url, json=None, timeout=None):
        path = url.split("/repos/o/r/")[1]
        self.calls.append((method, path, json))
        if method == "GET" and path.startswith("git/ref/heads/"):
            return _Res(200, {"object": {"sha": self.head}}) if self.head else _Res(404, {})
        if method == "GET" and path.startswith("git/commits/"):
            return _Res(200, {"tree": {"sha": "T0"}})
        if method == "GET" and path.startswith("git/trees/"):
            return _Res(200, {"tree": [{"path": p, "sha": s, "type": "blob"} for p, s in self.tree.items()]})
        if method == "POST" and path == "git/blobs":
            return _Res(201, {"sha": g.blob_sha(json["content"].encode())})
        if method == "POST" and path == "git/trees":
            return _Res(201, {"sha": "T1"})
        if method == "POST" and path == "git/commits":
            return _Res(201, {"sha": "C1"})
        if method in ("PATCH", "POST") and path.startswith("git/refs"):
            return _Res(200, {})
        return _Res(500, {})


def _hook(fake):
    h = g.GitHubDataHook()
    h._session, h.repo, h.branch = fake, "o/r", "web-data"
    return h


def test_commit_creates_branch_when_missing():
    fake = _FakeGitHub()
    res = _hook(fake).commit_files({"web/a.json": b"1\n"}, "chore: x")
    assert res == {"sha": "C1", "changed": ["web/a.json"]}
    commit = next(c for c in fake.calls if c[1] == "git/commits")
    assert commit[2]["parents"] == []  # 첫 커밋
    assert ("POST", "git/refs") == next((c[0], c[1]) for c in fake.calls if c[1].startswith("git/refs"))


def test_commit_only_changed_and_fast_forward():
    fake = _FakeGitHub(head="H0", tree={"web/a.json": g.blob_sha(b"1\n"), "web/b.json": "old"})
    res = _hook(fake).commit_files({"web/a.json": b"1\n", "web/b.json": b"2\n"}, "chore: x", expected_head="H0")
    assert res["changed"] == ["web/b.json"]
    blobs = [c for c in fake.calls if c[1] == "git/blobs"]
    assert len(blobs) == 1  # 바뀐 파일만 업로드
    tree = next(c for c in fake.calls if c[1] == "git/trees")[2]
    assert tree["base_tree"] == "T0"
    ref = next(c for c in fake.calls if c[0] == "PATCH")
    assert ref[2] == {"sha": "C1", "force": False}  # 강제 갱신 없음


def test_no_change_no_commit():
    fake = _FakeGitHub(head="H0", tree={"web/a.json": g.blob_sha(b"1\n")})
    assert _hook(fake).commit_files({"web/a.json": b"1\n"}, "chore: x") is None
    assert not [c for c in fake.calls if c[0] in ("POST", "PATCH")]


def test_head_moved_since_compare_fails():
    fake = _FakeGitHub(head="H1")
    with pytest.raises(g.GitHubError) as e:
        _hook(fake).commit_files({"web/a.json": b"1\n"}, "chore: x", expected_head="H0")
    assert e.value.status == 409 and not [c for c in fake.calls if c[0] in ("POST", "PATCH")]


# 오류 메시지에 토큰·응답 본문 미포함
def test_error_hides_token():
    import requests

    class _Boom:
        def request(self, *a, **k):
            raise requests.ConnectionError("Authorization: Bearer SECRET_TOKEN")

    with pytest.raises(RuntimeError) as e:
        _hook(_Boom()).head()
    assert "SECRET_TOKEN" not in str(e.value) and e.value.__cause__ is None


def _bundle():
    regions = [{"adm_cd": "1"}, {"adm_cd": "2"}]
    return {
        "meta": {"publish_status": "current", "region_cnt": 2, "threshold": {"ver": "v"}},
        "regions": regions,
        "monthly": {"1": [], "2": []},
        "timeband": {},
        "admdong": {"features": [{"properties": {"adm_cd": c, "is_target": True}} for c in ("1", "2")]},
        "chargers": {"by_dong": [{}, {}]},
    }


def test_validate_bundle():
    from common import web_bundle as w

    assert w.validate(_bundle()) == []
    b = _bundle()
    b["regions"] = b["regions"][:1]
    b["meta"]["publish_status"] = "stale"
    probs = w.validate(b, {"admdong": w.MAX_BYTES + 1})
    assert any("게시 상태" in p for p in probs) and any("1행" in p for p in probs)
    assert any("admdong" in p and "bytes" in p for p in probs)
    # 링크 0개 동은 월별 추세 없어도 통과, 링크 있는 동이 빠지면 실패
    b = _bundle()
    b["regions"][1]["link_cnt"], b["monthly"] = 0, {"1": []}
    assert w.validate(b) == []
    b["regions"][1]["link_cnt"] = 3
    assert any("monthly" in p for p in w.validate(b))
    b = _bundle()
    b["admdong"]["features"].append({"properties": {"adm_cd": "9", "is_target": True}})
    assert any("미게시" in p for p in w.validate(b))
    assert w.validate({**_bundle(), "chargers": None}) == ["chargers: 없음"]
