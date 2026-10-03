-- =====================================================================
-- 002: 저자 추가 정보 컬럼 (관리자 전용 — 저자 입력폼에는 안 보임)
--   교신저자 연락처(tel, fax, address_ko, address_en)와
--   저자동의서용 정보(internal, default_role_ko)
-- Supabase SQL Editor 또는 DBeaver 에서 실행하세요. (여러 번 실행해도 안전)
-- =====================================================================
alter table public.authors add column if not exists tel             text;
alter table public.authors add column if not exists fax             text;
alter table public.authors add column if not exists address_ko      text;
alter table public.authors add column if not exists address_en      text;
alter table public.authors add column if not exists internal        boolean;  -- 원내(KIOM) 여부, 비어 있으면 동의서에서 원내로 처리
alter table public.authors add column if not exists default_role_ko text;     -- 저자동의서 '역할' 칸 기본값
