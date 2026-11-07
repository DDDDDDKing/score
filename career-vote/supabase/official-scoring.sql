CREATE OR REPLACE FUNCTION cv_private.claim_judge(p_name text, p_student_id text, p_phone text)
 RETURNS TABLE(session_token text, judge_name text, judge_group text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.cv_judges%rowtype; t text;
begin
 select * into j from public.cv_judges x where x.name=btrim(p_name) and x.student_id=btrim(p_student_id) and x.phone=btrim(p_phone) and x.is_active and x.judge_group='undergraduate' for update;
 if not found then raise exception '姓名、学号或电话号码不匹配，或评委已停用，请核对登记信息'; end if;
 select s.session_token into t from cv_private.judge_sessions s where s.judge_id=j.id;
 if t is null or j.token_hash is null or j.token_hash<>encode(extensions.digest(t,'sha256'),'hex') then
   t:=encode(extensions.gen_random_bytes(32),'hex');
   insert into cv_private.judge_sessions values(j.id,t) on conflict(judge_id) do update set session_token=excluded.session_token;
   update public.cv_judges set token_hash=encode(extensions.digest(t,'sha256'),'hex'),activated_at=now() where id=j.id;
 end if;
 return query select t,j.name,j.judge_group;
end;$function$;

CREATE OR REPLACE FUNCTION public.cv_whoami(p_token text)
 RETURNS TABLE(judge_name text, judge_group text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select j.name,j.judge_group from public.cv_judges j
 where j.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and j.is_active=true and j.judge_group='undergraduate'
   and length(p_token)=64; $function$;

CREATE OR REPLACE FUNCTION public.cv_my_scores(p_token text)
 RETURNS TABLE(contestant_id uuid, total numeric, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select s.contestant_id,s.total,s.created_at from public.cv_scores s
 join public.cv_judges j on j.id=s.judge_id
 join public.cv_contestants c on c.id=s.contestant_id and c.visible
 where j.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex') and j.is_active=true and j.judge_group='undergraduate' and length(p_token)=64; $function$;

CREATE OR REPLACE FUNCTION public.cv_submit_score(p_token text, p_contestant_id uuid, p_breakdown jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_judge_id uuid; v_max constant jsonb:='{"goal":25,"action":50,"improvement":25}'::jsonb; v_k text; v_value numeric; v_total numeric:=0; v_count int;
begin
  if not exists(select 1 from public.cv_settings where id=1 and voting_open=true) then raise exception '评分通道暂未开放'; end if;
  select j.id into v_judge_id from public.cv_judges j
    where length(coalesce(p_token,''))=64 and j.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and j.is_active=true and j.judge_group='undergraduate';
  if v_judge_id is null then raise exception '评委身份无效，请联系管理员'; end if;
  if not exists(select 1 from public.cv_contestants c where c.id=p_contestant_id and c.visible) then
    raise exception '选手不存在或暂未开放评分';
  end if;
  if p_breakdown is null or jsonb_typeof(p_breakdown)<>'object' or
     (select count(*) from jsonb_object_keys(p_breakdown))<>(select count(*) from jsonb_object_keys(v_max)) or
     exists (select 1 from jsonb_object_keys(p_breakdown) as b(k) where not(v_max ? b.k)) then
      raise exception '评分项目已更新，请刷新页面后重新填写';
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
end; $function$;
