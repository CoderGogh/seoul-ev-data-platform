# 테스트 공통 설정: Airflow 예제 비활성, plugins·scripts 경로 등록
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("AIRFLOW__CORE__LOAD_EXAMPLES", "False")
os.environ.setdefault("AIRFLOW__CORE__UNIT_TEST_MODE", "True")
for p in (ROOT / "plugins", ROOT / "scripts"):
    sys.path.insert(0, str(p))
