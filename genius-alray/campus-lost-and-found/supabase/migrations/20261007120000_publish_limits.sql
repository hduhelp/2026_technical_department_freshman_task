-- ============================================================
-- 发布频率限制（第 14 轮）
--
-- 第 9 轮给「认领」和「AI 调用」上了限流，但发布本身完全没有约束：
-- 一个账号可以无限往公开的失物墙上灌条目，每条最多 3 张 2MB 照片。
-- 这不是理论风险 —— 免费版 Supabase 只有 1GB 存储，约 170 条就能打满，
-- 而失物墙是所有人都会看的，被刷等于对全体用户不可用。
--
-- 阈值与其他限流一样放在 app_config（唯一真源），并且**在 RPC 内强制**：
-- 只写在 Server Action 里的话，直接打 PostgREST 就能绕过。
-- ============================================================

alter table public.app_config
  add column publish_per_day int not null default 10
    check (publish_per_day between 1 and 1000),
  add column publish_per_week int not null default 30
    check (publish_per_week between 1 and 1000);

-- 限流计数是「按 owner_id 扫最近 24 小时 / 7 天的条目」。
-- 现有的 found_items_list_idx 是 (created_at desc) where status <> 'withdrawn'，
-- 前缀对不上，帮不了这个查询，另外补一条覆盖索引。
create index if not exists found_items_owner_created_idx
  on public.found_items (owner_id, created_at desc);

-- ============================================================
-- publish_found_item：加入发布限流
--   签名不变（create or replace 会保留原有授权），只在开头插入计数检查。
-- ============================================================
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
  v_per_day int;
  v_per_week int;
  v_day int;
  v_week int;
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

  -- 限流放在字段校验之前：已经到上限的用户最需要看到的是「为什么发不出去」，
  -- 而不是某个与他无关的字段错误。
  --
  -- 统计口径是「最近创建的条目」，撤单的也算在内 ——
  -- 否则「发完立刻撤单」就成了一条绕过限流的免费通道
  -- （条目虽然从墙上消失了，但存储对象与写入成本已经产生）。
  select c.publish_per_day, c.publish_per_week into v_per_day, v_per_week
    from public.app_config c where c.id;

  select count(*) into v_day
    from public.found_items fi
   where fi.owner_id = v_uid
     and fi.created_at > now() - interval '24 hours';
  if v_day >= v_per_day then
    raise exception '24 小时内最多发布 % 条，请明天再试', v_per_day using errcode = 'P0001';
  end if;

  select count(*) into v_week
    from public.found_items fi
   where fi.owner_id = v_uid
     and fi.created_at > now() - interval '7 days';
  if v_week >= v_per_week then
    raise exception '7 天内最多发布 % 条，请稍后再试', v_per_week using errcode = 'P0001';
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

  -- 未登录访客要能刷失物墙，所以读配置的 RPC 对 anon 开放（它只返回 max_photos / page_size）
  execute 'grant execute on function public.get_app_config() to anon';
end;
$$;
