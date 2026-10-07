-- ============================================================
-- 图片存储：仍是私有桶
-- 列表与详情页都能看到图片，但一律由服务端签发短时效 URL，
-- 客户端既不能直传也不能直读（上传走 /api/upload，用 service_role 写入）。
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
