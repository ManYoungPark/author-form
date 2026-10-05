-- =====================================================================
-- 004: 논문 투고 저널명 · 감사의 글(연구과제)
--   새 논문을 만들 때 이전 논문들에 쓴 값을 목록으로 보여줘 다시 고를 수 있게 한다.
--   저자동의서(HWPX) 생성 시 저널명·감사의 글로도 쓸 수 있다.
-- Supabase SQL Editor 또는 DBeaver 에서 실행하세요. (여러 번 실행해도 안전)
-- =====================================================================
alter table public.papers add column if not exists journal         text;
alter table public.papers add column if not exists acknowledgement text;
