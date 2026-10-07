-- ============================================================
-- RLS 与列级权限
--
-- 与上一版的根本区别：**招领物品现在是公开可浏览的**（用户明确改判了
-- 早先「禁止获取全部物品列表」的要求）。因此防护重心从「行级不可见」
-- 转为「列级保密」：
--   行级：登录用户可读全部未撤单物品（已认领的也在墙上，带标签）
--   列级：contact / location_* 对客户端 REVOKE，只能经 RPC 取得，
--         且仅限拾主本人或已提交领取记录的人
-- ============================================================

alter table public.profiles          enable row level security;
alter table public.found_items       enable row level security;
alter table public.found_item_images enable row level security;
alter table public.pickups           enable row level security;
alter table public.app_config        enable row level security;

-- ---------- profiles：仅自己 ----------
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------- found_items：未撤单的全部可读（含已认领）----------
-- 【第 7 轮】未登录用户也能刷信息流，所以 anon 也要能读（但只能读未撤单的公开列）。
create policy found_items_select_public on public.found_items
  for select to anon
  using (status <> 'withdrawn');

create policy found_items_select_visible on public.found_items
  for select to authenticated
  using (status <> 'withdrawn' or owner_id = (select auth.uid()));
-- 写操作一律走 SECURITY DEFINER RPC，客户端没有任何写策略

-- ---------- found_item_images：随所属物品的可见性 ----------
create policy found_item_images_select_public on public.found_item_images
  for select to anon
  using (
    exists (
      select 1 from public.found_items fi
      where fi.id = found_item_images.found_item_id and fi.status <> 'withdrawn'
    )
  );

create policy found_item_images_select_visible on public.found_item_images
  for select to authenticated
  using (
    exists (
      select 1 from public.found_items fi
      where fi.id = found_item_images.found_item_id
        and (fi.status <> 'withdrawn' or fi.owner_id = (select auth.uid()))
    )
  );

-- ---------- pickups：拾主 与 认领人本人 可见 ----------
create policy pickups_select_involved on public.pickups
  for select to authenticated
  using (
    picker_id = (select auth.uid())
    or exists (
      select 1 from public.found_items fi
      where fi.id = pickups.found_item_id and fi.owner_id = (select auth.uid())
    )
  );

-- app_config：不建任何策略 → 客户端完全不可读

-- ============================================================
-- 列级权限
-- 表级权限优先于列级，必须先把表级权限撤净再按列授予
-- ============================================================
revoke all on public.profiles, public.found_items, public.found_item_images,
  public.pickups, public.app_config
  from anon, authenticated;

-- profiles：RLS 只允许读/改自己那一行。
grant select (id, real_name, phone, created_at, updated_at)
  on public.profiles to authenticated;
grant update (real_name, phone) on public.profiles to authenticated;

-- found_items
-- 【关键】可读列**不含** contact / location_lat / location_lng / location_label。
-- 任何客户端查询（包括 select 星号）碰这些列都会直接 42501，
-- 联系方式与位置在数据库层就不可能泄露。
grant select (id, owner_id, title, description, custody, status,
              created_at, updated_at, claimed_at, withdrawn_at)
  on public.found_items to authenticated;
-- 未登录访客只能读失物墙需要的公开列（同样不含 contact / location_*）
grant select (id, owner_id, title, description, custody, status,
              created_at, updated_at, claimed_at, withdrawn_at)
  on public.found_items to anon;

-- found_item_images：只读（写入由 publish RPC 完成）
grant select (id, found_item_id, storage_path, position, created_at)
  on public.found_item_images to authenticated;
grant select (id, found_item_id, storage_path, position, created_at)
  on public.found_item_images to anon;

-- pickups：只读（写入由 create_pickup RPC 完成）
grant select (id, found_item_id, picker_id, picker_name, picker_phone,
              created_at, updated_at)
  on public.pickups to authenticated;
