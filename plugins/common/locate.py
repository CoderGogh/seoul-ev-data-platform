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


# 도로명 주소 정리: 공백 정리, 시도 보정
def road_address(addr):
    if not addr or not addr.strip():
        return None
    tokens = addr.split()
    if not tokens[0].startswith("서울"):
        tokens = [SIDO, *tokens]
    return " ".join(tokens)


# 판정 순서: 원천 좌표 → 도로명 → 지번. 같은 실행 안에서만 주소별 결과 재사용
# geocode(address, addr_type) → (lng, lat) 또는 None
def locate_all(targets, geocode):
    memo, out, calls = {}, [], 0
    for t in targets:
        lng, lat, source = t.get("lng"), t.get("lat"), "source_coord"
        if lng is None:
            lng = lat = None
            source = "none"
            for addr_type, addr in (("road", road_address(t.get("road_addr"))),
                                    ("parcel", parcel_address(t.get("parcel_addr")))):  # fmt: skip
                if not addr:
                    continue
                if (addr_type, addr) not in memo:
                    memo[(addr_type, addr)] = geocode(addr, addr_type)
                    calls += 1
                pt = memo[(addr_type, addr)]
                if pt:
                    lng, lat = pt
                    source = f"geocoded_{addr_type}"
                    break
        out.append({"src": t["src"], "src_key": t["src_key"], "lng": lng, "lat": lat, "loc_source": source})
    return out, calls
