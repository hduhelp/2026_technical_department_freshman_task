-- ============================================================
-- 显式授权：service_role 的表权限（第 15 轮）
--
-- 【线上事故】上传图片报 `permission denied for table image_uploads`（42501）。
--
-- 根因：此前的迁移只显式 grant 了 found_items / found_item_images 以及
-- 各 RPC 的 execute，**其余表一律指望 Supabase 平台的「新建表自动授权」**
-- （auto_expose_new_tables / postgres 角色的 default privileges）。
-- 那个机制只对「由 postgres 角色创建」的对象生效，而 supabase CLI 推迁移时
-- 用的是临时登录角色（cli_login_postgres）；云端新项目默认又已改成
-- 「必须显式 GRANT」。两头一叠加 → 表建出来了，但 anon / authenticated /
-- service_role 一个权限都没有，service_role 写 image_uploads 直接 42501。
--
-- 为什么本地永远复现不出来：本地 supabase/config.toml 的 auto_expose_new_tables
-- 默认按 true 走，隐式授权把洞兜住了。两边的默认值不同 —— 这正是最难查的一类偏差。
--
-- 修法：
--   1) 这里把 service_role 需要的权限显式写死（它是我们的服务端身份：
--      /api/upload 落库、失败回滚、草稿回收、签名 URL 都要用它）；
--   2) config.toml 里把 auto_expose_new_tables 设成 false，本地与云端同一套规则，
--      这类问题以后本地就能跑到（回归用例见 tests/rls/17-server-privileges.test.ts）。
--
-- 只 grant 不 revoke 任何客户端权限：RLS 策略与列级 REVOKE 一字未动。
-- 本迁移可重复执行（grant / revoke 都幂等），手工在 SQL Editor 里跑过也不会脏。
-- ============================================================

-- service_role 绕过 RLS，但仍然需要表级权限；它是唯一该拿到全权的主体
grant all privileges on
  public.profiles,
  public.found_items,
  public.found_item_images,
  public.pickups,
  public.app_config,
  public.image_uploads,
  public.ai_calls,
  public.publish_drafts,
  public.publish_draft_images
  to service_role;

-- 表里有 identity / 序列时，插入还需要序列权限（ai_calls 是 identity）
grant usage, select on all sequences in schema public to service_role;

-- 顺手把「谁绝不能碰」写显式：这两张表对客户端完全不可读（写一律走 RPC）
revoke all on public.app_config, public.ai_calls from anon, authenticated;
