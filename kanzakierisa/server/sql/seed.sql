-- 校园失物招领系统 · 演示数据
--
-- 三个演示账号，密码统一为 123456：
--   alice / bob / carol
-- 下面的 password_hash 是 "123456" 经 bcrypt cost=10 生成的哈希。
-- 若需重新生成，可用任意 bcrypt 工具（cost=10）计算后替换本文件中的哈希值。
--
-- 导入方式：mysql -uroot -p < sql/seed.sql

USE lost_found;

-- 先按外键依赖倒序清空，保证可重复执行。
DELETE FROM claims;
DELETE FROM posts;
DELETE FROM users;

-- ============ 用户 ============
-- contact_public: alice 主动公开联系方式，用于演示「作者公开」这条可见性规则。
INSERT INTO users (id, username, password_hash, nickname, contact, contact_public, role) VALUES
  (1, 'alice', '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '小明', 'wx: alice_hdu', 1, 'user'),
  (2, 'bob',   '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '小红', 'qq: 12345678',  0, 'user'),
  (3, 'carol', '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '管理员', 'tel: 13800000000', 0, 'admin');

-- ============ 帖子 ============
-- 6 条：3 条 lost + 3 条 found，覆盖 open / matched / closed 三种状态与多个分类。
-- images 统一为空数组，避免演示依赖外部图片。happened_at 用相对当前时间的表达式，保证数据始终"新鲜"。
INSERT INTO posts (id, user_id, type, title, category, location, happened_at, description, images, status) VALUES
  -- 1) alice 丢校园卡 —— open
  (1, 1, 'lost', '黑色卡套校园卡', 'card', '下沙校区图书馆 3 楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 4 DAY),
   '黑色卡套，里面是校园卡，卡号尾号 0421，卡套背面有一张皮卡丘贴纸。', '[]', 'open'),

  -- 2) alice 丢耳机 —— matched（bob 的招领帖已通过审核）
  (2, 1, 'lost', '白色 AirPods 左耳', 'digital', '下沙校区一教 205',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY),
   '左耳耳机丢失，充电盒还在，序列号可提供。', '[]', 'matched'),

  -- 3) alice 丢专业书 —— closed
  (3, 1, 'lost', '《编译原理》第三版', 'book', '下沙校区二教自习室',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY),
   '书上有大量蓝色笔记，扉页写了名字。', '[]', 'closed'),

  -- 4) bob 捡到校园卡 —— open（与 alice 的 1 号帖构成潜在匹配：category card + 时间接近）
  (4, 2, 'found', '捡到一张校园卡', 'card', '下沙校区图书馆一楼大厅',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY),
   '在自动借还机旁边捡到，卡套是黑色的，已交到图书馆前台。', '[]', 'open'),

  -- 5) bob 捡到钥匙 —— open
  (5, 2, 'found', '捡到一串钥匙（带小熊挂件）', 'key', '下沙校区食堂二楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY),
   '钥匙串上有一个棕色小熊挂件，共 4 把钥匙。', '[]', 'open'),

  -- 6) carol 捡到水杯 —— open
  (6, 3, 'found', '捡到一个保温杯', 'other', '下沙校区体育馆',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY),
   '银色保温杯，杯身有宿舍楼号贴纸。', '[]', 'open');

-- ============ 认领记录 ============
-- 2 条：1 条 pending（待审核）、1 条 approved（已通过，带凭证码）。
-- 两条都挂在 found 帖上，符合 SPEC 7.3「只有 found 帖可被认领」。
INSERT INTO claims (id, post_id, claimant_id, proof, status, voucher_code, reviewed_at) VALUES
  -- alice 认领 bob 的 5 号"捡到钥匙"帖 —— pending，待 bob 审核
  (1, 5, 1, '钥匙串上确实有棕色小熊挂件，第 3 把钥匙刻了"302"字样，是我宿舍门钥匙。',
   'pending', NULL, NULL),

  -- alice 认领 bob 的 4 号"捡到校园卡"帖 —— approved（带凭证码，对应帖子已 open→matched）
  (2, 4, 1, '卡套背面确实有皮卡丘贴纸，我的学号尾号是 0421。', 'approved', 'K7M2QX',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY));
