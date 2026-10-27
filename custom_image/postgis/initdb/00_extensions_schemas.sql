-- 볼륨 최초 생성 시 1회 실행

-- 공간 확장
CREATE EXTENSION IF NOT EXISTS postgis;

-- 계층별 스키마
CREATE SCHEMA IF NOT EXISTS staging;     -- 원천 적재
CREATE SCHEMA IF NOT EXISTS core;        -- 정제·이력·마스터
CREATE SCHEMA IF NOT EXISTS mart;        -- 게시 결과
CREATE SCHEMA IF NOT EXISTS ops;         -- 실행 상태·계보
CREATE SCHEMA IF NOT EXISTS quarantine;  -- 오염 레코드 격리
