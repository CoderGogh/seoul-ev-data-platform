# ev16 외부 보관: Supabase Storage 업로드·목록·삭제 요청 형태, 한도, 키 비노출 (실제 호출 없음)
import pytest
from hooks import supabase_storage_hook as s

FAKE_KEY = "_".join(["sb", "secret", "FAKE"])  # 가짜 값 (비밀값 탐지 오탐 방지)


class _Res:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body
        self.content = b"x" if body is not None else b""

    def json(self):
        return self._body


# 가짜 Storage: 요청 기록
class _FakeStorage:
    def __init__(self, status=200, listing=None):
        self.status, self.listing, self.calls = status, listing or [], []

    def request(self, method, url, timeout=None, **kw):
        self.calls.append((method, url.split("/storage/v1/")[1], kw))
        if "object/list/" in url:
            return _Res(self.status, self.listing)
        return _Res(self.status, {})


def _hook(fake):
    h = s.SupabaseStorageHook()
    h._session, h.base, h.bucket = fake, "https://x.supabase.co", "db-backups"
    return h


def test_upload(tmp_path):
    f = tmp_path / "ev_platform_20261115T0200.dump"
    f.write_bytes(b"dump")
    fake = _FakeStorage()
    assert _hook(fake).upload(f)["file"] == f.name
    method, path, kw = fake.calls[0]
    assert (method, path) == ("POST", f"object/db-backups/{f.name}")
    assert kw["headers"]["x-upsert"] == "true"


# 무료 한도 초과는 호출 전 중단
def test_upload_too_large(tmp_path, monkeypatch):
    f = tmp_path / "big.dump"
    f.write_bytes(b"x" * 11)
    monkeypatch.setattr(s, "MAX_BYTES", 10)
    fake = _FakeStorage()
    with pytest.raises(RuntimeError, match="한도"):
        _hook(fake).upload(f)
    assert fake.calls == []


# 폴더(id 없음) 제외, 삭제는 한 번에
def test_list_and_remove():
    fake = _FakeStorage(listing=[{"name": "a.dump", "id": "1"}, {"name": "dir", "id": None}])
    h = _hook(fake)
    assert h.list_names() == ["a.dump"]
    assert h.remove([]) == [] and len(fake.calls) == 1
    h.remove(["a.dump"])
    method, path, kw = fake.calls[-1]
    assert (method, path, kw["json"]) == ("DELETE", "object/db-backups", {"prefixes": ["a.dump"]})


# 오류 메시지에 키·응답 본문 미포함
def test_error_hides_key():
    import requests

    class _Boom:
        def request(self, *a, **k):
            raise requests.ConnectionError(f"apikey: {FAKE_KEY}")

    with pytest.raises(RuntimeError) as e:
        _hook(_Boom()).list_names()
    assert FAKE_KEY not in str(e.value) and e.value.__cause__ is None
    with pytest.raises(RuntimeError, match="HTTP 403"):
        _hook(_FakeStorage(status=403)).list_names()
