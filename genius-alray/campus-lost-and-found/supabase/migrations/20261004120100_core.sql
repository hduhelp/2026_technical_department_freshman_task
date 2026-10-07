-- ============================================================
-- 简化后的数据模型
--   招领物品（拍照 + AI 生成名称/描述 + 电话或位置）
--   公开浏览列表（登录后可见全部已发布物品）
--   领取记录（真实姓名 + 手机号，用于追查与审计）
-- 已删除：tags / found_item_tags / lost_reports / lost_report_tags /
--          matches / claims / claim_attempts（答题、审核、匹配、寻物帖全部取消）
-- ============================================================

-- ============================================================
-- 枚举
-- ============================================================
create type public.custody_kind as enum ('kept', 'in_place');
-- published = 在墙上、可认领、可撤单
-- claimed   = 已被某人认领（仍在墙上，带「已认领」标签，不可再认领；拾主不能撤单）
-- withdrawn = 拾主在被认领前撤单（从墙上消失，仅拾主可见）
create type public.item_status as enum ('published', 'claimed', 'withdrawn');

-- ============================================================
-- 通用触发器
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================
-- 运行期配置（客户端不可读，只能经 RPC）
-- ============================================================
create table public.app_config (
  id boolean primary key default true,
  max_photos int not null default 3 check (max_photos between 1 and 20),
  page_size int not null default 20 check (page_size between 1 and 50),
  updated_at timestamptz not null default now(),
  constraint app_config_single_row check (id)
);
insert into public.app_config (id) values (true);

-- ============================================================
-- 用户资料（由 auth.users 触发器自动创建）
-- ============================================================
-- 【第 7 轮】登录方式改为「手机号 + 密码」：手机号就是账号（内部映射为 <phone>@<域名>），
-- 真实姓名与手机号在注册时必填，因此 profiles 里两列都是 NOT NULL，手机号唯一。
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  real_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_real_name_len check (
    char_length(btrim(real_name)) between 2 and 20
  ),
  constraint profiles_phone_format check (phone ~ '^1[3-9][0-9]{9}$')
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 注册时 supabase.auth.signUp 通过 options.data 传 real_name / phone，
-- 触发器把它们落到 profiles。缺字段直接报错（只有站内注册这一条创建用户的路径）。
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'real_name', '')), '');
  v_phone text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
begin
  if v_name is null or v_phone is null then
    raise exception '注册需要真实姓名与手机号' using errcode = '22023';
  end if;
  insert into public.profiles (id, real_name, phone)
  values (new.id, v_name, v_phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 招领物品
--   title / description 由视觉模型生成，发布者可在发布前修改
--   custody = kept     → 代为保管，存联系电话
--   custody = in_place → 留在原地，存位置坐标或位置描述
--   contact / location_* 是机密列：数据库层对客户端 REVOKE，
--   只有拾主本人或已提交领取记录的人能经 RPC 取得
-- ============================================================
create table public.found_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null,
  custody public.custody_kind not null,
  contact text,
  location_lat double precision,
  location_lng double precision,
  location_label text,
  status public.item_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 第一次被认领 / 拾主撤单的时刻，二者互斥
  claimed_at timestamptz,
  withdrawn_at timestamptz,
  constraint found_items_title_len check (char_length(btrim(title)) between 1 and 60),
  constraint found_items_desc_len check (char_length(btrim(description)) between 1 and 600),
  constraint found_items_contact_len check (
    contact is null or char_length(btrim(contact)) between 5 and 100
  ),
  constraint found_items_label_len check (
    location_label is null or char_length(btrim(location_label)) between 1 and 200
  ),
  constraint found_items_coords check (
    (location_lat is null and location_lng is null)
    or (location_lat is not null and location_lng is not null
        and location_lat between -90 and 90 and location_lng between -180 and 180)
  ),
  -- 保管方式与对应信息必须齐全
  constraint found_items_custody_payload check (
    case custody
      when 'kept' then contact is not null
      when 'in_place' then location_lat is not null or location_label is not null
      else false
    end
  )
);
create trigger found_items_touch before update on public.found_items
  for each row execute function public.touch_updated_at();
-- 失物墙 = 未被撤单的全部物品（已认领的也留在墙上，只是带标签）
create index found_items_list_idx on public.found_items (created_at desc) where status <> 'withdrawn';
create index found_items_owner_idx on public.found_items (owner_id, created_at desc);

create table public.found_item_images (
  id uuid primary key default gen_random_uuid(),
  found_item_id uuid not null references public.found_items (id) on delete cascade,
  storage_path text not null unique,
  position int not null default 0 check (position between 0 and 19),
  created_at timestamptz not null default now()
);
create index found_item_images_item_idx on public.found_item_images (found_item_id, position);

-- ============================================================
-- 认领记录
--   picker_name / picker_phone 是认领人的真实姓名与手机号。
--   认领即归属：第一个认领的人会把物品置为 claimed，之后别人不能再认领；
--   认领人自己重复提交视为更新（改姓名/手机号）。
--   可见性：拾主 + 认领人本人。
-- ============================================================
create table public.pickups (
  id uuid primary key default gen_random_uuid(),
  found_item_id uuid not null references public.found_items (id) on delete cascade,
  picker_id uuid not null references auth.users (id) on delete cascade,
  picker_name text not null,
  picker_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickups_name_len check (char_length(btrim(picker_name)) between 2 and 20),
  constraint pickups_phone_format check (picker_phone ~ '^[0-9+\- ]{6,20}$'),
  unique (found_item_id, picker_id)
);
create index pickups_item_idx on public.pickups (found_item_id, created_at desc);
create index pickups_picker_idx on public.pickups (picker_id, created_at desc);
create trigger pickups_touch before update on public.pickups
  for each row execute function public.touch_updated_at();
