-- ============================================================
-- 发布草稿（第 10 轮）
--
--   每个用户**只有一个**草稿（`user_id` 就是主键，数据库层保证「不能同时存在多个」），
--   发布页每次打开看到的都是同一份。
--
--   它同时是存储清理的抓手：照片在上传成功的那一刻就挂到草稿上，于是
--     * 从草稿里移除照片 = 登记行 + 对象一起删掉，不再留孤儿；
--     * 放弃的草稿是一个**有边界的清理单位**（自己的照片都在自己名下），
--       可以由 scripts/prune-drafts.mjs 整体回收。
-- ============================================================

create table public.publish_drafts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  title text not null default '',
  description text not null default '',
  custody public.custody_kind,
  contact text,
  location_lat double precision,
  location_lng double precision,
  location_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_drafts_title_len check (char_length(title) <= 60),
  constraint publish_drafts_desc_len check (char_length(description) <= 600),
  constraint publish_drafts_contact_len check (
    contact is null or char_length(contact) <= 100
  ),
  constraint publish_drafts_label_len check (
    location_label is null or char_length(location_label) <= 200
  ),
  constraint publish_drafts_coords check (
    (location_lat is null and location_lng is null)
    or (location_lat is not null and location_lng is not null
        and location_lat between -90 and 90 and location_lng between -180 and 180)
  )
);
create trigger publish_drafts_touch before update on public.publish_drafts
  for each row execute function public.touch_updated_at();

-- 草稿里的照片：position 即展示顺序
create table public.publish_draft_images (
  user_id uuid not null references public.publish_drafts (user_id) on delete cascade,
  upload_id uuid not null references public.image_uploads (id) on delete cascade,
  position int not null default 0 check (position between 0 and 19),
  created_at timestamptz not null default now(),
  primary key (user_id, upload_id)
);
create index publish_draft_images_order_idx
  on public.publish_draft_images (user_id, position);

-- ---------- 权限：只读自己的草稿，写一律走 RPC ----------
alter table public.publish_drafts enable row level security;
alter table public.publish_draft_images enable row level security;

create policy publish_drafts_select_own on public.publish_drafts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy publish_draft_images_select_own on public.publish_draft_images
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.publish_drafts, public.publish_draft_images
  from anon, authenticated;
grant select (
  user_id, title, description, custody, contact,
  location_lat, location_lng, location_label, created_at, updated_at
) on public.publish_drafts to authenticated;
grant select (user_id, upload_id, position, created_at)
  on public.publish_draft_images to authenticated;

-- ---------- 保存草稿的文本字段 ----------
-- 客户端每次都提交完整快照（而不是增量 patch），所以这里是整体覆盖：
-- 不会出现「某个字段没传就被清空」这种歧义。
create or replace function public.save_publish_draft(
  p_title text default null,
  p_description text default null,
  p_custody public.custody_kind default null,
  p_contact text default null,
  p_location_lat double precision default null,
  p_location_lng double precision default null,
  p_location_label text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_title text := coalesce(btrim(p_title), '');
  v_description text := coalesce(btrim(p_description), '');
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_label text := nullif(btrim(coalesce(p_location_label, '')), '');
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  -- 用中文提示而不是让 CHECK 抛英文原文
  if char_length(v_title) > 60 then
    raise exception '物品名称最多 60 字' using errcode = '22023';
  end if;
  if char_length(v_description) > 600 then
    raise exception '物品描述最多 600 字' using errcode = '22023';
  end if;
  if v_contact is not null and char_length(v_contact) > 100 then
    raise exception '联系方式最多 100 字' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 200 then
    raise exception '位置详情最多 200 字' using errcode = '22023';
  end if;

  insert into public.publish_drafts (
    user_id, title, description, custody, contact,
    location_lat, location_lng, location_label
  )
  values (
    v_uid, v_title, v_description, p_custody, v_contact,
    p_location_lat, p_location_lng, v_label
  )
  on conflict (user_id) do update set
    title = excluded.title,
    description = excluded.description,
    custody = excluded.custody,
    contact = excluded.contact,
    location_lat = excluded.location_lat,
    location_lng = excluded.location_lng,
    location_label = excluded.location_label;
end;
$$;

-- ---------- 把照片挂到草稿 / 从草稿移除 ----------
-- 由 /api/upload 在上传成功后立刻调用：照片从落桶那一刻起就属于草稿。
create or replace function public.attach_draft_photo(p_upload_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_upload public.image_uploads;
  v_max int;
  v_count int;
  v_position int;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_upload
    from public.image_uploads u
   where u.id = p_upload_id
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

  select count(*) into v_count
    from public.publish_draft_images
   where user_id = v_uid;

  -- 幂等：重试同一次上传不该占两张的名额
  if exists (
    select 1 from public.publish_draft_images
     where user_id = v_uid and upload_id = p_upload_id
  ) then
    return v_count;
  end if;

  select c.max_photos into v_max from public.app_config c where c.id;
  if v_count >= v_max then
    raise exception '每个物品最多 % 张照片', v_max using errcode = '22023';
  end if;

  -- 草稿行可能还不存在（先传照片、还没填内容）
  insert into public.publish_drafts (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select coalesce(max(position) + 1, 0) into v_position
    from public.publish_draft_images
   where user_id = v_uid;

  insert into public.publish_draft_images (user_id, upload_id, position)
  values (v_uid, p_upload_id, v_position);

  -- 摸一下 updated_at：清理脚本按「最后一次活动」回收草稿，
  -- 只看文本保存的话，一个只在加照片的活跃草稿会被误判成僵尸。
  -- （publish_drafts_touch 触发器会把 updated_at 置成 now()）
  update public.publish_drafts set updated_at = now() where user_id = v_uid;

  return v_count + 1;
end;
$$;

-- 从草稿移除一张照片：删登记行，并把存储路径交回给调用方去删对象。
-- （删对象需要 service_role，只能由服务端做；数据库这边保证「登记先消失」。）
create or replace function public.detach_draft_photo(p_upload_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_consumed timestamptz;
begin
  if v_uid is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select u.storage_path, u.consumed_at
    into v_path, v_consumed
    from public.publish_draft_images di
    join public.image_uploads u on u.id = di.upload_id
   where di.user_id = v_uid and di.upload_id = p_upload_id
   for update of u;
  if not found then
    raise exception '草稿里没有这张照片' using errcode = 'P0002';
  end if;
  if v_consumed is not null then
    raise exception '照片已被使用，无法移除' using errcode = 'P0001';
  end if;

  delete from public.image_uploads where id = p_upload_id;

  -- 同 attach：移除照片也算「草稿还在被使用」
  update public.publish_drafts set updated_at = now() where user_id = v_uid;

  return v_path;
end;
$$;

-- ---------- 发布成功后：草稿就算用完了 ----------
-- 签名没变，直接 create or replace 即可（不需要 drop）。
create or replace function public.publish_found_item(
  p_title text,
  p_description text,
  p_custody public.custody_kind,
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

  -- 草稿用完了：清掉（级联删掉草稿照片关联；image_uploads 保留 consumed_at 记录）
  delete from public.publish_drafts where user_id = v_uid;

  return v_item_id;
end;
$$;

-- ---------- 函数执行权限 ----------
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
    'public.consume_ai_quota()',
    'public.save_publish_draft(text, text, public.custody_kind, text, double precision, double precision, text)',
    'public.attach_draft_photo(uuid)',
    'public.detach_draft_photo(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_authed loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;

  execute 'grant execute on function public.get_app_config() to anon';
end;
$$;
