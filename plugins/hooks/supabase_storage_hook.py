# Supabase Storage Hook: 백업 파일 외부 보관 (비공개 버킷, 업로드·목록·삭제)
# Connection: host=프로젝트 URL, password=secret 키(sb_secret_) 또는 service_role, extra={"bucket": "db-backups"}
import requests
from airflow.sdk import BaseHook
from airflow.sdk.exceptions import AirflowNotFoundException
from airflow.sdk.log import mask_secret

MAX_BYTES = 50 * 1024 * 1024  # 무료 플랜 파일당 한도


class SupabaseStorageHook(BaseHook):
    conn_name_attr = "conn_id"
    default_conn_name = "conn_supabase_backup"
    hook_name = "Supabase Storage"

    def __init__(self, conn_id=default_conn_name, timeout=300, **kwargs):
        super().__init__(**kwargs)
        self.conn_id = conn_id
        self.timeout = timeout
        self._session = None
        self.base = None
        self.bucket = None

    # 설정 여부 (Connection 없음·URL·키 비면 False)
    def configured(self):
        try:
            c = self.get_connection(self.conn_id)
        except AirflowNotFoundException:
            return False
        return bool(c.host and c.password)

    def get_conn(self):
        if self._session is None:
            c = self.get_connection(self.conn_id)
            mask_secret(c.password)  # Task 로그 가림
            self.base = c.host.rstrip("/")
            if not self.base.startswith("http"):
                self.base = f"https://{self.base}"
            self.bucket = c.extra_dejson.get("bucket", "db-backups")
            s = requests.Session()
            s.headers["apikey"] = c.password
            if c.password.startswith("eyJ"):  # 예전 service_role JWT만 Bearer 병행
                s.headers["Authorization"] = f"Bearer {c.password}"
            self._session = s
        return self._session

    # 호출 1회. 오류는 상태 코드·경로만 (응답 본문·헤더 미기록)
    def _req(self, method, path, ok=(200,), **kw):
        s = self.get_conn()
        try:
            r = s.request(method, f"{self.base}/storage/v1/{path}", timeout=self.timeout, **kw)
        except requests.RequestException as e:
            raise RuntimeError(f"Supabase {method} {path} 호출 실패: {type(e).__name__}") from None
        if r.status_code not in ok:
            raise RuntimeError(f"Supabase {method} {path} HTTP {r.status_code}")
        return r.json() if r.content else {}

    # 파일 업로드 (같은 이름 덮어씀)
    def upload(self, path):
        size = path.stat().st_size
        if size > MAX_BYTES:
            raise RuntimeError(f"{path.name} {size / 1024 / 1024:.1f}MB > 한도 {MAX_BYTES // 1024 // 1024}MB")
        self.get_conn()
        with open(path, "rb") as f:
            self._req(
                "POST", f"object/{self.bucket}/{path.name}", data=f,
                headers={"Content-Type": "application/octet-stream", "x-upsert": "true"},
            )  # fmt: skip
        return {"file": path.name, "size_mb": round(size / 1024 / 1024, 1)}

    # 버킷 최상위 파일명
    def list_names(self):
        self.get_conn()
        rows = self._req("POST", f"object/list/{self.bucket}", json={"prefix": "", "limit": 1000})
        return [r["name"] for r in rows if r.get("id")]  # 폴더(id 없음) 제외

    def remove(self, names):
        if not names:
            return []
        self.get_conn()
        self._req("DELETE", f"object/{self.bucket}", json={"prefixes": list(names)})
        return list(names)
