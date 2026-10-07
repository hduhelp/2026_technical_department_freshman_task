-- ============================================================
-- 安全重构（第 9 轮）：不再把「客户端传来的存储路径」当成信任凭据
--
--   1) image_uploads 登记表：客户端只拿到不透明 uuid，存储路径永远由服务端
--      生成与使用。归属校验从「字符串前缀相等」变成「这行登记是不是你的」，
--      顺带消灭了 '..' / '//' / 前缀花招这一整类问题。
--   2) publish_found_item 改收 p_upload_ids uuid[]（不再有 p_paths）。
--   3) create_pickup 的实名信息改为服务端从 profiles 读取 —— 客户端提交的
--      姓名手机号一律不算数（之前只做长度校验，等于没有实名）。
--   4) 认领与 AI 调用的频率限制，阈值放在 app_config（唯一真源，RPC 强制）。
-- ============================================================

-- ============================================================
-- 运行期配置：限流阈值
-- ============================================================
alter table public.app_config
  add column claim_per_hour int not null default 2
    check (claim_per_hour between 1 and 1000),
  add column claim_per_day int not null default 5
    check (claim_per_day between 1 and 1000),
  add column ai_per_hour int not null default 10
    check (ai_per_hour between 1 and 1000);

-- ============================================================
-- 上传登记
--   一行 = 一次成功写入私有桶的对象。客户端只知道 id；
--   storage_path 只由 /api/upload（service_role）写入，读取由服务端签名用。
-- ============================================================
create table public.image_uploads (
  id uuid primary key,
  uploader_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  -- 被某次发布引用后置位。storage_path 在 found_item_images 里是唯一的，
  -- 所以同一张照片只能挂到一个物品上，重复引用必须被明确拒绝。
  consumed_at timestamptz
);
create index image_uploads_uploader_idx
  on public.image_uploads (uploader_id, created_at desc);

alter table public.image_uploads enable row level security;

-- 自己读自己的登记（服务端签名 / AI 识别要用）；客户端没有任何写权限
create policy image_uploads_select_own on public.image_uploads
  for select to authenticated
  using (uploader_id = (select auth.uid()));

revoke all on public.image_uploads from anon, authenticated;
grant select (id, uploader_id, storage_path, created_at, consumed_at)
  on public.image_uploads to authenticated;

-- ============================================================
-- AI 调用计数（限流的唯一真源，客户端完全不可见）
-- ============================================================
create table public.ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;

/**
 * 消耗一次 AI 配额。
 * 登录用户每小时最多 app_config.ai_per_hour 次；超限时返回 allowed = false，
 * 由调用方决定怎么降级（本项目是「跳过 AI，让用户手填」）。
 * 顺手清掉本用户 2 小时前的计数行，表不会无限增长，也就不需要定时任务。
 */
create or replace function public.consume_ai_quota()
returns table (out_allowed boolean, out_used int, out_limit int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_used int;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select c.ai_per_hour into v_limit from public.app_config c where c.id;

  delete from public.ai_calls ac
   where ac.user_id = v_uid
     and ac.created_at < now() - interval '2 hours';

  select count(*) into v_used
    from public.ai_calls ac
   where ac.user_id = v_uid
     and ac.created_at > now() - interval '1 hour';

  if v_used >= v_limit then
    return query select false, v_used, v_limit;
    return;
  end if;

  insert into public.ai_calls (user_id) values (v_uid);
  return query select true, v_used + 1, v_limit;
end;
$$;

-- ============================================================
-- 发布：改收 upload id
-- ============================================================
-- 参数列表变了，必须显式 drop：create or replace 只会多出一个重载，
-- 客户端用旧参数调用仍然能命中，等于没改。
drop function if exists public.publish_found_item(
  text, text, public.custody_kind, text, double precision, double precision, text, text[]
);

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
  p_upload_ids uuid[] default null
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
  v_upload public.image_uploads;
  v_upload_id uuid;
  v_path text;
  v_paths text[] := array[]::text[];
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

  if p_upload_ids is null or array_length(p_upload_ids, 1) is null then
    raise exception '请至少上传一张照片' using errcode = '22023';
  end if;
  if array_length(p_upload_ids, 1) > v_max then
    raise exception '每个物品最多 % 张照片', v_max using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_upload_ids) as x)
     <> array_length(p_upload_ids, 1) then
    raise exception '同一张照片不能重复使用' using errcode = '22023';
  end if;

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

  -- 先把所有照片校验完再落库：任何一张不合格就整体失败，不留半成品物品
  foreach v_upload_id in array p_upload_ids loop
    select u.* into v_upload
      from public.image_uploads u
     where u.id = v_upload_id
     for update;
    if not found then
      raise exception '照片不存在或已失效，请重新上传' using errcode = 'P0002';
    end if;
    if v_upload.uploader_id <> v_uid then
      raise exception '照片不属于当前账号' using errcode = '42501';
    end if;
    if v_upload.consumed_at is not null then
      raise exception '照片已被使用，请重新上传' using errcode = 'P0001';
    end if;
    v_paths := array_append(v_paths, v_upload.storage_path);
  end loop;

  insert into public.found_items (
    owner_id, title, description, custody, contact,
    location_lat, location_lng, location_label, status
  )
  values (
    v_uid, v_title, v_description, p_custody, v_contact,
    p_location_lat, p_location_lng, v_label, 'published'
  )
  returning id into v_item_id;

  foreach v_path in array v_paths loop
    insert into public.found_item_images (found_item_id, storage_path, position)
    values (v_item_id, v_path, v_position);
    v_position := v_position + 1;
  end loop;

  update public.image_uploads
     set consumed_at = now()
   where id = any (p_upload_ids);

  return v_item_id;
end;
$$;

-- ============================================================
-- 认领：实名信息由服务端决定 + 频率限制
-- ============================================================
drop function if exists public.create_pickup(uuid, text, text);

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
  -- （之前 p_name / p_phone 由调用方自由提交，只校验长度 —— 「实名认领」名存实亡。）
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

  v_mine := exists (
    select 1 from public.pickups pk
    where pk.found_item_id = p_item_id and pk.picker_id = v_uid
  );

  -- 限流只针对「新增认领」：重复提交是更新自己那条记录，不该被计次，
  -- 否则用户改个名字就被挡在门外。
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
-- 函数执行权限（签名变了，重新收干净再逐一授予）
-- ============================================================
do $$
declare
  v_authed text[] := array[
    'public.get_app_config()',
    'public.publish_found_item(text, text, public.custody_kind, text, double precision, double precision, text, uuid[])',
    'public.withdraw_found_item(uuid)',
    'public.release_found_item_claim(uuid)',
    'public.list_found_item_claimers(uuid)',
    'public.create_pickup(uuid)',
    'public.reveal_found_item_contact(uuid)',
    'public.consume_ai_quota()'
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
