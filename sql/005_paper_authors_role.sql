-- =====================================================================
-- 005: 논문별 저자 참여구분 (저자동의서 '참여구분' 칸)
--   '공동저자' | '제1저자' | '교신저자' | '제1저자, 교신저자'
--   공동 제1저자·공동 교신저자는 여러 명에게 같은 값을 지정한다.
--   is_corresponding 은 호환용으로 함께 맞춰 둔다 (교신저자 포함이면 true).
-- Supabase SQL Editor 또는 DBeaver 에서 실행하세요. (여러 번 실행해도 안전)
-- =====================================================================
alter table public.paper_authors add column if not exists author_role text not null default '공동저자';

-- 기존에 교신저자로 지정해 둔 저자는 그대로 교신저자로
update public.paper_authors set author_role = '교신저자'
where is_corresponding and author_role = '공동저자';
