-- ============================================================
-- 撤回认领：只有「没有其他人还在认领」时才把物品放回待认领（第 18 轮）
--
-- 【缺陷】release_found_item_claim 无条件把 status 从 claimed 改回 published。
-- 第 7 轮起允许多人认领（pickups 的唯一约束是 (found_item_id, picker_id)，
-- 认领只是登记，归属靠线下协商），于是：
--   A、B 都认领 → 物品 claimed；
--   A 点「领错了？」→ 物品被改回 published，B 的认领被无声作废；
--   墙上重新出现「我要认领」，第三人也能再认领。
--
-- 【修法】给 pickups 增加 released_at（撤回时刻），用「released_at is null」表示
-- 「还在认领」。撤回只把自己那条记录标记为已撤回（记录保留，之后还能再认领）：
--   - 还有别的活跃认领 → 物品保持 claimed；
--   - 一个活跃认领都不剩 → 物品回到 published。
-- 认领人名单与揭晓联系方式同样只看活跃记录，避免把已撤回的人继续当成认领人。
--
-- 【为什么必须加列】「认领记录保留」是既有需求（审计 + 允许再认领），
-- 单看 pickups 行是否存在无法区分「仍在认领」和「已撤回」，只判断
-- 「有没有别人的行」会让最后一个撤回的人永远把物品卡在 claimed。
-- ============================================================

alter table public.pickups
  add column if not exists released_at timestamptz;

comment on column public.pickups.released_at is
  '撤回认领的时刻；null = 仍在认领。记录保留，撤回后仍可重新认领。';

-- 活跃认领的查询（物品状态判定 / 认领人名单）走这条部分索引
create index if not exists pickups_active_item_idx
  on public.pickups (found_item_id) where released_at is null;

-- 【必须显式授权】pickups 的 SELECT 是列级 GRANT（20261004120200_rls_and_grants.sql），
-- 新列默认不可读；客户端要按 released_at is null 过滤，缺了会直接 42501。
grant select (released_at) on public.pickups to authenticated;

-- ============================================================
-- create_pickup：重新认领时清空 released_at（复用同一条记录，行数不增加）
-- ============================================================
create or replace function public.create_pickup(p_item_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_name text;
  v_phone text;
  v_per_hour int;
  v_per_day int;
  v_hour int;
  v_day int;
  v_mine boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  -- 实名 = 服务端从 profiles 取，客户端说什么都不算数。
  select p.real_name, p.phone into v_name, v_phone
    from public.profiles p
   where p.id = v_uid;
  if not found then
    raise exception '请先在「我的信息」里填写真实姓名与手机号' using errcode = 'P0001';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id for update;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  if v_item.owner_id = v_uid then
    raise exception '不能认领自己发布的物品' using errcode = '42501';
  end if;
  if v_item.status = 'withdrawn' then
    raise exception '该物品已撤单，无法认领' using errcode = 'P0001';
  end if;

  -- 记录存在（哪怕是撤回过的）就走 upsert：撤回后再认领不会新增行。
  -- 限流只针对「新增行」，这里保持既有语义不变。
  v_mine := exists (
    select 1 from public.pickups pk
    where pk.found_item_id = p_item_id and pk.picker_id = v_uid
  );

  if not v_mine then
    select c.claim_per_hour, c.claim_per_day into v_per_hour, v_per_day
      from public.app_config c where c.id;

    select count(*) into v_hour
      from public.pickups pk
     where pk.picker_id = v_uid
       and pk.created_at > now() - interval '1 hour';
    if v_hour >= v_per_hour then
      raise exception '1 小时内最多认领 % 件，请稍后再试', v_per_hour using errcode = 'P0001';
    end if;

    select count(*) into v_day
      from public.pickups pk
     where pk.picker_id = v_uid
       and pk.created_at > now() - interval '24 hours';
    if v_day >= v_per_day then
      raise exception '24 小时内最多认领 % 件，请明天再试', v_per_day using errcode = 'P0001';
    end if;
  end if;

  insert into public.pickups (found_item_id, picker_id, picker_name, picker_phone)
  values (p_item_id, v_uid, v_name, v_phone)
  on conflict (found_item_id, picker_id)
    do update set picker_name = excluded.picker_name,
                  picker_phone = excluded.picker_phone,
                  released_at = null,
                  updated_at = now()
  returning id into v_id;

  -- 认领即归属：第一次认领时把物品标记为已认领
  if v_item.status = 'published' then
    update public.found_items
       set status = 'claimed', claimed_at = now()
     where id = p_item_id;
  end if;

  return v_id;
end;
$$;

-- ============================================================
-- release_found_item_claim：撤回认领（「拿错了，不是我的」）
--   只摘掉自己；别人还在认领时物品保持 claimed。
-- ============================================================
create or replace function public.release_found_item_claim(p_item_id uuid)
returns public.item_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_active boolean;
  v_others int;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  -- 锁住物品行：并发的撤回 / 认领被串行化，判「还有没有别人」不会读到中间状态
  select * into v_item from public.found_items fi where fi.id = p_item_id for update;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  -- 只有「还在认领」的人才谈得上撤回；撤回过的记录保留但不能重复撤回
  select exists (
    select 1 from public.pickups pk
    where pk.found_item_id = p_item_id
      and pk.picker_id = v_uid
      and pk.released_at is null
  ) into v_active;
  if not v_active then
    raise exception '你没有认领过这件物品' using errcode = '42501';
  end if;

  -- 先摘掉自己（记录保留，只打撤回时间戳）
  update public.pickups
     set released_at = now()
   where found_item_id = p_item_id
     and picker_id = v_uid
     and released_at is null;

  -- 再看还有没有别人在认领
  select count(*) into v_others
    from public.pickups pk
   where pk.found_item_id = p_item_id
     and pk.released_at is null;

  if v_others > 0 then
    -- 还有别人在认领：物品保持 claimed，撤回的人只是退出名单
    return 'claimed'::public.item_status;
  end if;

  if v_item.status = 'claimed' then
    update public.found_items
       set status = 'published', claimed_at = null
     where id = p_item_id;
    return 'published'::public.item_status;
  end if;

  -- 撤单等其它状态不改动，如实返回
  return v_item.status;
end;
$$;

-- ============================================================
-- list_found_item_claimers：只列「还在认领」的人
--   撤回过的人不该再出现在别人的协商名单里。
-- ============================================================
create or replace function public.list_found_item_claimers(p_item_id uuid)
returns table (
  out_picker_id uuid,
  out_picker_name text,
  out_picker_phone text,
  out_created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  v_allowed := v_item.owner_id = v_uid
    or exists (
      select 1 from public.pickups pk
      where pk.found_item_id = p_item_id
        and pk.picker_id = v_uid
        and pk.released_at is null
    );
  if not v_allowed then
    raise exception '请先认领该物品' using errcode = '42501';
  end if;

  return query
    select pk.picker_id, pk.picker_name, pk.picker_phone, pk.created_at
      from public.pickups pk
     where pk.found_item_id = p_item_id
       and pk.released_at is null
     order by pk.created_at asc;
end;
$$;

-- ============================================================
-- reveal_found_item_contact：拾主本人 或 还在认领的人
--   撤回即放弃认领，不再放行联系方式 / 位置。
-- ============================================================
create or replace function public.reveal_found_item_contact(p_item_id uuid)
returns table (
  out_custody public.custody_kind,
  out_contact text,
  out_location_lat double precision,
  out_location_lng double precision,
  out_location_label text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  v_allowed := v_item.owner_id = v_uid
    or exists (
      select 1 from public.pickups p
      where p.found_item_id = p_item_id
        and p.picker_id = v_uid
        and p.released_at is null
    );

  if not v_allowed then
    raise exception '请先提交领取信息' using errcode = '42501';
  end if;

  return query
    select v_item.custody, v_item.contact,
           v_item.location_lat, v_item.location_lng, v_item.location_label;
end;
$$;

-- ============================================================
-- 函数执行权限（签名未变，create or replace 会保留原授权；这里显式重申，
-- 与前面几个迁移的写法保持一致，也便于手工重放）
-- ============================================================
do $$
declare
  v_authed text[] := array[
    'public.create_pickup(uuid)',
    'public.release_found_item_claim(uuid)',
    'public.list_found_item_claimers(uuid)',
    'public.reveal_found_item_contact(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_authed loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end;
$$;
