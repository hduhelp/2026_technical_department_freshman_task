-- 校园失物招领 · 数据库 schema
-- 执行方式：supabase db query --linked -f supabase/schema.sql
-- 全部语句幂等，可反复执行；本文件不是 migration，不会被 db push 消费。

-- pg_trgm 装在 extensions schema（Supabase 的约定）。
-- 下面所有函数都用 search_path = '' 并把引用的对象写全限定名，避免 search_path 被劫持。
create extension if not exists pg_trgm with schema extensions;

do $body$ begin
  create type public.item_kind as enum ('lost', 'found');
exception when duplicate_object then null; end $body$;

do $body$ begin
  create type public.item_status as enum ('open', 'resolved');
exception when duplicate_object then null; end $body$;

-- ------------------------------------------------------------------ 表

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_len check (char_length(username) between 2 and 20)
);

-- 用户名大小写不敏感唯一。字符集校验在应用层（lib/validation.ts）。
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        public.item_kind not null,
  title       text not null check (char_length(title) between 1 and 60),
  description text not null default '' check (char_length(description) <= 1000),
  location    text not null check (char_length(location) between 1 and 80),
  happened_at timestamptz not null,
  image_path  text,
  status      public.item_status not null default 'open',
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  search_text text generated always as
    (title || ' ' || description || ' ' || location) stored
);

-- 列表默认只看 status = 'open'，所以用部分索引：更小、写更快
create index if not exists items_open_created_idx
  on public.items (created_at desc) where status = 'open';

-- 等值列在前、范围列在后
create index if not exists items_open_kind_idx
  on public.items (kind, created_at desc) where status = 'open';

-- 外键列必须有索引，否则级联删除与按作者过滤都很慢
create index if not exists items_user_idx
  on public.items (user_id, created_at desc);

-- pg_trgm 走 GIN
create index if not exists items_title_trgm_idx
  on public.items using gin (title extensions.gin_trgm_ops);
create index if not exists items_search_trgm_idx
  on public.items using gin (search_text extensions.gin_trgm_ops);

-- 联系方式单独一表：anon key 是公开的，只靠应用层过滤等于没过滤。
-- item_id 是主键，已覆盖该外键列。
create table if not exists public.item_contacts (
  item_id uuid primary key references public.items(id) on delete cascade,
  contact text not null check (char_length(contact) between 1 and 100)
);

-- ------------------------------------------------------------------ RLS

alter table public.items         enable row level security;
alter table public.item_contacts enable row level security;
alter table public.profiles      enable row level security;

drop policy if exists items_read   on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
drop policy if exists contacts_read   on public.item_contacts;
drop policy if exists contacts_insert on public.item_contacts;
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;

-- 所有人都能浏览帖子（含未登录）。用 TO 子句，不用已废弃的 auth.role()。
create policy items_read on public.items
  for select to anon, authenticated
  using (true);

create policy items_insert on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- UPDATE 必须同时写 USING 和 WITH CHECK，否则能把 user_id 改成别人的
create policy items_update on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy items_delete on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 联系方式：只有登录用户能读（这就是「登录后可见」的落点）
create policy contacts_read on public.item_contacts
  for select to authenticated
  using (true);

-- 只能给自己名下的帖子写联系方式
create policy contacts_insert on public.item_contacts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.user_id = (select auth.uid())
    )
  );

create policy profiles_read on public.profiles
  for select to anon, authenticated
  using (true);

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- --------------------------------------------------------------- GRANT
-- SQL 建的表不一定自动暴露给 Data API，所以显式授权；RLS 再管行。

revoke all on public.profiles from anon, authenticated;
grant select (id, username, created_at) on public.profiles to anon, authenticated;
grant insert (id, username) on public.profiles to authenticated;

grant select on public.items to anon, authenticated;
grant insert, update on public.items to authenticated;

grant select on public.item_contacts to authenticated;
grant insert on public.item_contacts to authenticated;

-- service_role（服务端密钥）需要完整 DML。
-- 新项目给新表的默认权限只有 REFERENCES/TRIGGER/TRUNCATE，不带 DML，
-- 不显式授权的话，用 service_role 反而读写不了自己建的表。
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.items to service_role;
grant select, insert, update, delete on public.item_contacts to service_role;

-- 收掉 Supabase 默认附带、但这套 Data API 用不到的权限（最小权限原则）
revoke truncate, references, trigger on public.profiles from anon, authenticated;
revoke truncate, references, trigger on public.items from anon, authenticated;
revoke truncate, references, trigger on public.item_contacts
  from anon, authenticated;

-- ----------------------------------------------------------------- 函数
-- 一律 SECURITY INVOKER（不加 security definer），因此受调用者 RLS 约束。

create or replace function public.similar_items(
  p_kind public.item_kind,
  p_title text,
  p_description text default '',
  p_location text default '',
  p_happened_at timestamptz default null,
  p_limit int default 5
)
returns table (
  id uuid, kind public.item_kind, title text, location text,
  happened_at timestamptz, image_path text, score real
)
language sql
stable
set search_path = ''
as $body$
  with scored as (
    select i.id, i.kind, i.title, i.location, i.happened_at, i.image_path,
      (0.55 * greatest(
                extensions.similarity(i.title, p_title),
                extensions.word_similarity(p_title, i.title))
     + 0.25 * extensions.similarity(
                coalesce(i.description, ''), coalesce(p_description, ''))
     + 0.20 * extensions.similarity(
                coalesce(i.location, ''), coalesce(p_location, ''))
      )::real as score
    from public.items i
    where i.kind = p_kind and i.status = 'open'
  )
  select scored.id, scored.kind, scored.title, scored.location,
         scored.happened_at, scored.image_path, scored.score
  from scored
  where scored.score >= 0.2
  order by scored.score desc, scored.happened_at desc nulls last
  limit least(greatest(p_limit, 1), 20);
$body$;

create or replace function public.search_items(
  p_q text default '',
  p_kind public.item_kind default null,
  p_include_resolved boolean default false,
  p_only_user uuid default null,
  p_limit int default 12,
  p_offset int default 0
)
returns table (
  id uuid, kind public.item_kind, title text, location text,
  happened_at timestamptz, image_path text, status public.item_status,
  created_at timestamptz, username text, total bigint
)
language sql
stable
set search_path = ''
as $body$
  with base as (
    select i.id, i.kind, i.title, i.location, i.happened_at, i.image_path,
           i.status, i.created_at, pr.username,
           case when coalesce(p_q, '') = '' then 0::real
                else greatest(
                  extensions.similarity(i.search_text, p_q),
                  case when i.search_text ilike '%' || p_q || '%' then 1 else 0 end)
           end as score
    from public.items i
    join public.profiles pr on pr.id = i.user_id
    where (p_kind is null or i.kind = p_kind)
      and (p_include_resolved or i.status = 'open')
      and (p_only_user is null or i.user_id = p_only_user)
      and (coalesce(p_q, '') = ''
           or i.search_text operator(extensions.%) p_q
           or i.search_text ilike '%' || p_q || '%')
  )
  select base.id, base.kind, base.title, base.location, base.happened_at,
         base.image_path, base.status, base.created_at, base.username,
         count(*) over () as total
  from base
  order by base.score desc, base.created_at desc
  limit least(greatest(p_limit, 1), 50)
  offset least(greatest(p_offset, 0), 1000);
$body$;

-- 用户名是否可用（大小写不敏感）。返回 true 表示可用。
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
set search_path = ''
as $body$
  select not exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(btrim(p_username))
  );
$body$;

create or replace function public.get_item(p_id uuid)
returns table (
  id uuid, user_id uuid, kind public.item_kind, title text, description text,
  location text, happened_at timestamptz, image_path text,
  status public.item_status, resolved_at timestamptz, created_at timestamptz,
  username text
)
language sql
stable
set search_path = ''
as $body$
  select i.id, i.user_id, i.kind, i.title, i.description, i.location,
         i.happened_at, i.image_path, i.status, i.resolved_at, i.created_at,
         pr.username
  from public.items i
  join public.profiles pr on pr.id = i.user_id
  where i.id = p_id;
$body$;

-- --------------------------------------------------------------- Storage

insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

drop policy if exists photos_public_read  on storage.objects;
drop policy if exists photos_owner_insert on storage.objects;

create policy photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'item-photos');

-- 路径约定 <uid>/<uuid>.<ext>，只能写自己目录。
-- 注意：这里只给 INSERT。以后若要做「覆盖同一个文件」，
-- 必须同时允许 SELECT + UPDATE，否则 upsert 会静默失败。
create policy photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
