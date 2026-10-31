-- 中南大学第十二届大学生职业规划大赛 | 大众评委评分系统
-- 在专用 Supabase 项目的 SQL Editor 中运行本文件。
-- 请勿把 service_role / secret key 写入网页源码。
-- 所有公开表均启用 RLS；参赛者仅通过有限能力的 RPC 获得信息。
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cv_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.cv_settings (
  id integer primary key default 1 check (id=1),
  title text not null default '中南大学第十二届大学生职业规划大赛 · 初赛',
  voting_open boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.cv_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.cv_judges (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 40),
  student_id text not null unique check(length(student_id) between 3 and 40),
  judge_group text not null check(judge_group in ('undergraduate','graduate')),
  is_active boolean not null default true,
  activated_at timestamptz,
  token_hash text unique,
  created_at timestamptz not null default now()
);
create index if not exists cv_judges_group_idx on public.cv_judges(judge_group);

create table if not exists public.cv_contestants (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 60),
  lane text not null check(lane in ('growth','employment')),
  employment_type text check(employment_type is null or employment_type in ('product','production','marketing','general','public')),
  display_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint cv_employment_type_required check ((lane='growth' and employment_type is null) or (lane='employment' and employment_type is not null))
);
create index if not exists cv_contestants_lane_order_idx on public.cv_contestants(lane,display_order);

create table if not exists public.cv_scores (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references public.cv_judges(id) on delete restrict,
  contestant_id uuid not null references public.cv_contestants(id) on delete restrict,
  breakdown jsonb not null,
  total numeric(5,2) not null check(total between 0 and 100),
  created_at timestamptz not null default now(),
  unique(judge_id, contestant_id)
);
create index if not exists cv_scores_contestant_idx on public.cv_scores(contestant_id);

alter table public.cv_admins enable row level security;
alter table public.cv_settings enable row level security;
alter table public.cv_judges enable row level security;
alter table public.cv_contestants enable row level security;
alter table public.cv_scores enable row level security;

-- 默认撤销表 Data API 访问，只有已登录并列入 cv_admins 的用户才可访问数据表。
revoke all on public.cv_admins, public.cv_settings, public.cv_judges, public.cv_contestants, public.cv_scores from anon, authenticated;
grant select on public.cv_admins to authenticated;
grant select, update on public.cv_settings to authenticated;
grant select, insert, update, delete on public.cv_judges, public.cv_contestants, public.cv_scores to authenticated;

create or replace function public.cv_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.cv_admins a where a.user_id = (select auth.uid())); $$;
revoke all on function public.cv_is_admin() from public, anon;
grant execute on function public.cv_is_admin() to authenticated;

create policy "cv_admin_self_read" on public.cv_admins for select to authenticated
  using(user_id = (select auth.uid()));
create policy "cv_admin_settings" on public.cv_settings for all to authenticated
  using ((select public.cv_is_admin())) with check ((select public.cv_is_admin()));
create policy "cv_admin_judges" on public.cv_judges for all to authenticated
  using ((select public.cv_is_admin())) with check ((select public.cv_is_admin()));
create policy "cv_admin_contestants" on public.cv_contestants for all to authenticated
  using ((select public.cv_is_admin())) with check ((select public.cv_is_admin()));
create policy "cv_admin_scores" on public.cv_scores for all to authenticated
  using ((select public.cv_is_admin())) with check ((select public.cv_is_admin()));

-- 公开页面只能看到赛事的名称和开放状态，不得读取评委名单、学号与所有成绩。
create or replace function public.cv_public_settings()
returns table (title text,voting_open boolean)
language sql stable security definer set search_path = ''
as $$ select s.title,s.voting_open from public.cv_settings s where s.id=1; $$;
revoke all on function public.cv_public_settings() from public;
grant execute on function public.cv_public_settings() to anon, authenticated;

create or replace function public.cv_public_contestants()
returns table (id uuid,name text,lane text,employment_type text,display_order integer)
language sql stable security definer set search_path = ''
as $$ select c.id,c.name,c.lane,c.employment_type,c.display_order from public.cv_contestants c
       where c.visible=true order by c.lane,c.display_order,c.created_at; $$;
revoke all on function public.cv_public_contestants() from public;
grant execute on function public.cv_public_contestants() to anon, authenticated;

-- 姓名+学号只可领取一次令牌，使用数据库 UPDATE 保证跨设备原子互斥。
create or replace function public.cv_claim_judge(p_name text,p_student_id text)
returns table (session_token text,judge_name text,judge_group text)
language plpgsql security definer set search_path = ''
as $$
declare v_token text; v_judge public.cv_judges%rowtype;
begin
  if length(btrim(coalesce(p_name,'')))<1 or length(btrim(coalesce(p_student_id,'')))<3 then
    raise exception '请填写有效姓名和学号';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  update public.cv_judges j set token_hash=encode(extensions.digest(v_token,'sha256'),'hex'), activated_at=now()
    where j.student_id=btrim(p_student_id) and j.name=btrim(p_name)
      and j.is_active=true and j.token_hash is null
    returning j.* into v_judge;
  if not found then raise exception '信息未匹配，或该评委身份已在其他设备激活。请联系管理员核查'; end if;
  return query select v_token,v_judge.name,v_judge.judge_group;
end; $$;
revoke all on function public.cv_claim_judge(text,text) from public;
grant execute on function public.cv_claim_judge(text,text) to anon, authenticated;

create or replace function public.cv_whoami(p_token text)
returns table (judge_name text,judge_group text)
language sql stable security definer set search_path = ''
as $$ select j.name,j.judge_group from public.cv_judges j
 where j.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and j.is_active=true
   and length(p_token)=64; $$;
revoke all on function public.cv_whoami(text) from public;
grant execute on function public.cv_whoami(text) to anon, authenticated;

create or replace function public.cv_my_scores(p_token text)
returns table (contestant_id uuid,total numeric,created_at timestamptz)
language sql stable security definer set search_path = ''
as $$ select s.contestant_id,s.total,s.created_at from public.cv_scores s
 join public.cv_judges j on j.id=s.judge_id
 where j.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and j.is_active=true and length(p_token)=64; $$;
revoke all on function public.cv_my_scores(text) from public;
grant execute on function public.cv_my_scores(text) to anon, authenticated;

-- 返回当前赛道及就业细分类别的评分上限。任何评分都在数据库端再次校验。
create or replace function public.cv_submit_score(p_token text,p_contestant_id uuid,p_breakdown jsonb)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare v_judge_id uuid; v_lane text; v_type text; v_max jsonb; v_k text; v_value numeric; v_total numeric:=0; v_count int;
begin
  if not exists(select 1 from public.cv_settings where id=1 and voting_open=true) then raise exception '评分通道暂未开放'; end if;
  select j.id into v_judge_id from public.cv_judges j
    where length(coalesce(p_token,''))=64 and j.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and j.is_active=true;
  if v_judge_id is null then raise exception '评委身份无效，请联系管理员'; end if;
  select c.lane,c.employment_type into v_lane,v_type from public.cv_contestants c
    where c.id=p_contestant_id and c.visible=true;
  if v_lane is null then raise exception '选手不存在或暂未开放评分'; end if;
  if v_lane='growth' then
    v_max:='{"goal":20,"action":40,"alignment":30,"intent":10}'::jsonb;
  elsif v_type in ('product','production') then
    v_max:='{"general":35,"awareness":20,"competency":25,"potential":10,"intent":10}'::jsonb;
  else
    v_max:='{"general":45,"awareness":15,"competency":20,"potential":10,"intent":10}'::jsonb;
  end if;
  if p_breakdown is null or jsonb_typeof(p_breakdown)<>'object' or
     (select count(*) from jsonb_object_keys(p_breakdown))<>(select count(*) from jsonb_object_keys(v_max)) or
     exists (select 1 from jsonb_object_keys(p_breakdown) as b(k) where not(v_max ? b.k)) then
      raise exception '评分字段不符合该赛道标准';
  end if;
  for v_k in select key from jsonb_each(v_max) loop
    if jsonb_typeof(p_breakdown->v_k)<>'number' then raise exception '每一项评分都必须填写'; end if;
    v_value:=(p_breakdown->>v_k)::numeric;
    if v_value<0 or v_value>(v_max->>v_k)::numeric or v_value*2<>trunc(v_value*2) then
       raise exception '评分超出区间或不符合 0.5 分步长';
    end if;
    v_total:=v_total+v_value;
  end loop;
  insert into public.cv_scores(judge_id,contestant_id,breakdown,total)
  values(v_judge_id,p_contestant_id,p_breakdown,v_total) on conflict(judge_id,contestant_id) do nothing;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception '该选手已经提交过评分，不能重复提交'; end if;
  return v_total;
end; $$;
revoke all on function public.cv_submit_score(text,uuid,jsonb) from public;
grant execute on function public.cv_submit_score(text,uuid,jsonb) to anon, authenticated;

-- 安全设置：请先通过 Supabase Auth 创建一名管理员账户，然后运行：
-- insert into public.cv_admins(user_id)
-- select id from auth.users where email='你的管理员邮箱' on conflict do nothing;
-- 如果查不到此邮箱，先在 Dashboard → Authentication → Users 创建并确认账户。