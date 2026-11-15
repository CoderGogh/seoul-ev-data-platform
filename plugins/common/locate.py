# 수요 보조 위치 판정: 주소 정리·지오코딩 순서 (좌표는 실행 중 행정동 판정에만, 저장 금지)
import re

SIDO = "서울특별시"
LOT_RE = re.compile(r"^(산)?\d+(-\d+)?$")
DONG_RE = re.compile(r".+(동|가|리)\d*$")


# 지번 주소 정리: 시도 보정, 지번 뒤 단지명 제거, 부번 0 제거
# 예) "서울특별시 강남구 역삼동 795-41 역삼동월드메르디앙아파트" → "서울특별시 강남구 역삼동 795-41"
#     "강남구 압구정동 428-0" → "서울특별시 강남구 압구정동 428"
def parcel_address(addr):
    if not addr:
        return None
    tokens = addr.split()
    if tokens[0] != SIDO:
        tokens = [SIDO, *(tokens[1:] if tokens[0].startswith("서울") else tokens)]
    for i, t in enumerate(tokens):
        if i < 2 or not DONG_RE.match(t):
            continue
        rest = tokens[i + 1 :]
        if rest and rest[0] == "산" and len(rest) > 1 and LOT_RE.match(rest[1]):
            lot = "산" + rest[1]
        elif rest and LOT_RE.match(rest[0]):
            lot = rest[0]
        else:
            return None
        return " ".join([*tokens[: i + 1], re.sub(r"-0+$", "", lot)])
    return None


