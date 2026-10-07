-- ============================================================
-- RPC 层（全部 SECURITY DEFINER + 固定 search_path）
-- 客户端对 found_items / found_item_images / pickups 都没有写权限，
-- 所有写入都经过这里的校验。
--
-- 注意：RETURNS TABLE 的 OUT 参数一律加 out_ 前缀。
-- 这个项目已经因为 OUT 参数与列名撞名踩过两次 42702
-- （record_claim_attempt 的 status、upsert_tags 的 aspect），务必保持该约定。
-- ============================================================

-- ---------- 读取运行期配置 ----------
create or replace function public.get_app_config()
returns table (max_photos int, page_size int)
language sql stable security definer set search_path = public as $$
  select c.max_photos, c.page_size from public.app_config c where c.id;
$$;

-- ---------- 发布招领（拍照 → AI 名称/描述 → 电话或位置） ----------
create or replace function public.publish_found_item(
  p_title text,
  p_description text,
  p_custody public.custody_kind,
  -- 这 4 个参数必须有 DEFAULT：supabase-js 会把值为 undefined 的键整个丢掉，
  -- 而 PostgREST 按「请求体里出现的键集合」匹配函数 —— 没有 DEFAULT 就会 PGRST202
  -- 「Could not find the function」。有了 DEFAULT，省略键时自动取 null。
  p_contact text default null,
  p_location_lat double precision default null,
  p_location_lng double precision default null,
  p_location_label text default null,
  p_paths text[] default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_label text := nullif(btrim(coalesce(p_location_label, '')), '');
  v_max int;
  v_path text;
  v_item_id uuid;
  v_position int := 0;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 60 then
    raise exception '物品名称需在 1-60 字之间' using errcode = '22023';
  end if;
  if char_length(v_description) < 1 or char_length(v_description) > 600 then
    raise exception '物品描述需在 1-600 字之间' using errcode = '22023';
  end if;

  select c.max_photos into v_max from public.app_config c where c.id;

  if p_paths is null or array_length(p_paths, 1) is null then
    raise exception '请至少上传一张照片' using errcode = '22023';
  end if;
  if array_length(p_paths, 1) > v_max then
    raise exception '每个物品最多 % 张照片', v_max using errcode = '22023';
  end if;

  -- 只允许挂载到自己名下的对象（路径前缀必须是自己的 uid）
  foreach v_path in array p_paths loop
    if v_path not like v_uid::text || '/%' then
      raise exception '照片路径不合法' using errcode = '42501';
    end if;
  end loop;

  if p_custody = 'kept' then
    if v_contact is null or char_length(v_contact) < 5 then
      raise exception '代为保管需要填写联系方式（至少 5 个字符）' using errcode = '22023';
    end if;
  elsif p_custody = 'in_place' then
    -- 位置详情必填：只有坐标时失主还是不知道东西在哪（而且经纬度不该展示给用户），
    -- 坐标只是用来生成地图链接的补充信息。
    if v_label is null then
      raise exception '指定存放位置需要填写位置详情' using errcode = '22023';
    end if;
  else
    raise exception '保管方式不合法' using errcode = '22023';
  end if;

  insert into public.found_items (
    owner_id, title, description, custody, contact,
    location_lat, location_lng, location_label, status
  )
  values (
    v_uid, v_title, v_description, p_custody, v_contact,
    p_location_lat, p_location_lng, v_label, 'published'
  )
  returning id into v_item_id;

  foreach v_path in array p_paths loop
    insert into public.found_item_images (found_item_id, storage_path, position)
    values (v_item_id, v_path, v_position);
    v_position := v_position + 1;
  end loop;

  return v_item_id;
end;
$$;

-- ---------- 拾主撤单 ----------
-- 认领即归属：物品一旦被认领，拾主就不能再单方面处置（不能撤单）。
-- 只有还没人认领（status = 'published'）时才可以撤回。
create or replace function public.withdraw_found_item(p_item_id uuid)
returns public.item_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id for update;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;
  if v_item.owner_id <> v_uid then
    raise exception '无权操作该物品' using errcode = '42501';
  end if;
  if v_item.status = 'claimed' then
    raise exception '该物品已被认领，无法撤单' using errcode = 'P0001';
  end if;
  if v_item.status = 'withdrawn' then
    raise exception '该物品已撤单' using errcode = 'P0001';
  end if;

  update public.found_items
     set status = 'withdrawn', withdrawn_at = now()
   where id = p_item_id;

  return 'withdrawn'::public.item_status;
end;
$$;

-- ---------- 认领：提交真实姓名 + 手机号，并把物品标记为已认领 ----------
-- 【第 7 轮】允许**多人认领**同一物品：认领只是登记「我可能是失主」，
-- 谁拿走由线下协商（前端会展示其他认领人并给出协商提示）。
--   * 已撤单 → 拒绝
--   * 拾主不能认领自己的物品
--   * 同一人重复提交视为更新（改姓名/手机号），不产生第二条记录
create or replace function public.create_pickup(
  p_item_id uuid,
  p_name text,
  p_phone text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_mine boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 20 then
    raise exception '请填写真实姓名（2-20 字）' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9+\- ]{6,20}$' then
    raise exception '请填写有效的手机号' using errcode = '22023';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id for update;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  if v_item.owner_id = v_uid then
    raise exception '不能认领自己发布的物品' using errcode = '42501';
  end if;

  v_mine := exists (
    select 1 from public.pickups pk
    where pk.found_item_id = p_item_id and pk.picker_id = v_uid
  );

  if v_item.status = 'withdrawn' then
    raise exception '该物品已撤单，无法认领' using errcode = 'P0001';
  end if;

  insert into public.pickups (found_item_id, picker_id, picker_name, picker_phone)
  values (p_item_id, v_uid, v_name, v_phone)
  on conflict (found_item_id, picker_id)
    do update set picker_name = excluded.picker_name,
                  picker_phone = excluded.picker_phone,
                  updated_at = now()
  returning id into v_id;

  -- 认领即归属：第一次认领时把物品标记为已认领
  if v_item.status = 'published' then
    update public.found_items
       set status = 'claimed', claimed_at = now()
     where id = p_item_id;
  end if;

  -- 【第 7 轮起不再写回 profiles】手机号就是账号（唯一），
  -- 认领时前端直接提交账号里的姓名/手机号；如果这里再写回，
  -- 一旦认领用了别的号码就会让 auth 邮箱与 profiles.phone 不一致，
  -- 还会撞 profiles_phone_key 唯一约束。
  return v_id;
end;
$$;

-- ---------- 撤回认领（「拿错了，不是我的」）----------
-- 认领人本人可以把自己摘出来：物品回到待认领（published），
-- 但**提交过的认领记录保留**（审计需要，也方便他再改主意重新认领）。
create or replace function public.release_found_item_claim(p_item_id uuid)
returns public.item_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_item public.found_items;
  v_mine boolean;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_item from public.found_items fi where fi.id = p_item_id for update;
  if not found then
    raise exception '物品不存在' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.pickups pk
    where pk.found_item_id = p_item_id and pk.picker_id = v_uid
  ) into v_mine;
  if not v_mine then
    raise exception '你没有认领过这件物品' using errcode = '42501';
  end if;

  if v_item.status = 'claimed' then
    update public.found_items
       set status = 'published', claimed_at = null
     where id = p_item_id;
  end if;

  return 'published'::public.item_status;
end;
$$;

-- ---------- 列出某物品的全部认领人 ----------
-- 只有「拾主本人」或「已经认领过这件物品的人」能看到别人，用于协商冲突。
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
      where pk.found_item_id = p_item_id and pk.picker_id = v_uid
    );
  if not v_allowed then
    raise exception '请先认领该物品' using errcode = '42501';
  end if;

  return query
    select pk.picker_id, pk.picker_name, pk.picker_phone, pk.created_at
      from public.pickups pk
     where pk.found_item_id = p_item_id
     order by pk.created_at asc;
end;
$$;

-- ---------- 揭晓联系方式 / 位置 ----------
-- 仅拾主本人 或 已提交认领记录的人可以取得。
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
      where p.found_item_id = p_item_id and p.picker_id = v_uid
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
-- 函数执行权限
-- ============================================================
do $$
declare
  v_authed text[] := array[
    'public.get_app_config()',
    'public.publish_found_item(text, text, public.custody_kind, text, double precision, double precision, text, text[])',
    'public.withdraw_found_item(uuid)',
    'public.release_found_item_claim(uuid)',
    'public.list_found_item_claimers(uuid)',
    'public.create_pickup(uuid, text, text)',
    'public.reveal_found_item_contact(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_authed loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;

  -- 未登录访客要能刷失物墙，所以读配置的 RPC 对 anon 开放（它只返回 max_photos / page_size）
  execute 'grant execute on function public.get_app_config() to anon';
end;
$$;
