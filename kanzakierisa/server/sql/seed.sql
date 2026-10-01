-- 校园失物招领系统 · 演示数据
--
-- 三个演示账号，密码统一为 123456：
--   alice / bob / carol
-- 下面的 password_hash 是 "123456" 经 bcrypt cost=10 生成的哈希。
-- 若需重新生成，可用任意 bcrypt 工具（cost=10）计算后替换本文件中的哈希值。
--
-- 导入方式（Windows 下必须显式指定字符集，否则中文昵称会按 GBK 解码报错）：
--   mysql --default-character-set=utf8mb4 -uroot -p < sql/seed.sql
-- 或：
--   make seed
--
-- ============================ 数据规模与设计意图 ============================
--
-- 帖子的条数不是随手凑的，它直接决定后端能不能被验收：
--
--   * 总数 16 条 —— SPEC 任务的「基础要求」要练 WHERE / LIKE / ORDER BY /
--     LIMIT / OFFSET，样本太少则分页（pageSize=5 时不足 3 页）根本试不出来。
--     阶段文件 04 的验收明确要求 total >= 12。
--   * 类型 8 lost + 8 found —— 两侧均衡，避免「按类型筛选」看不出差异。
--   * 状态 open 8 / matched 5 / closed 3 —— **三种状态都必须有数据**，
--     否则「状态筛选」在某一态上恒返回 0，是上一版大纲的已知缺陷。
--   * 分类覆盖全部 6 个枚举 —— 组合筛选（type + status + category）才有可验证的用例。
--   * 标题含「校园卡」4 条、「耳机」3 条 —— 关键字搜索需要「能命中」与
--     「命中多条」两种可观察结果。
--   * created_at 逐条错开 —— 若全部由 DEFAULT CURRENT_TIMESTAMP 写入，
--     16 条会挤在同一秒，时间倒序与分页边界就都无法验证。
--   * images 统一为空数组 []，不依赖任何外部图片资源。
--
-- ==========================================================================

USE lost_found;

-- 先按外键依赖倒序清空，保证可重复执行。
DELETE FROM claims;
DELETE FROM posts;
DELETE FROM users;

-- ============================ 用户 ============================
-- contact_public: alice 主动公开联系方式，用于演示「作者主动公开」这条可见性规则；
-- bob / carol 不公开，于是「作者未公开 + 请求者非本人 + 无通过认领」时
-- 联系方式必须为空串 —— 三级可见性规则的两侧都有样本。
INSERT INTO users (id, username, password_hash, nickname, contact, contact_public, role) VALUES
  (1, 'alice', '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '小明', 'wx: alice_hdu', 1, 'user'),
  (2, 'bob',   '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '小红', 'qq: 12345678',  0, 'user'),
  (3, 'carol', '$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum', '管理员', 'tel: 13800000000', 0, 'admin');

-- ============================ 帖子（16 条） ============================
-- created_at 按 id 递增逐条变新（差值 24h，最后两条收窄到 18h / 24h），
-- 保证 ORDER BY created_at DESC 的结果是确定的 id 降序，分页边界可复现。
-- happened_at 一律早于 created_at 5 小时 —— 先丢东西，再发帖，顺序符合直觉。
INSERT INTO posts (id, user_id, type, title, category, location, happened_at, description, images, status, created_at, updated_at) VALUES
  -- ---------- alice（用户 1）：三态各一条，用于「我的帖子」状态 Tab ----------
  (1, 1, 'lost', '黑色卡套校园卡', 'card', '下沙校区图书馆 3 楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 365 HOUR),
   '黑色卡套，里面是校园卡，卡号尾号 0421，卡套背面有一张皮卡丘贴纸。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 360 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 360 HOUR)),

  (2, 1, 'lost', '白色 AirPods 左耳丢失', 'digital', '下沙校区一教 205',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 341 HOUR),
   '左耳耳机丢失，充电盒还在，序列号可提供。', '[]', 'matched',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 336 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 200 HOUR)),

  (3, 1, 'lost', '《编译原理》第三版', 'book', '下沙校区二教自习室',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 317 HOUR),
   '书上有大量蓝色笔记，扉页写了名字。', '[]', 'closed',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 312 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 100 HOUR)),

  -- ---------- bob（用户 2） ----------
  -- 4 号帖有一条 approved 认领（见下方 claims），按 SPEC 7.1「审核通过 → 帖子自动置 matched」，
  -- 因此这里的状态必须是 matched，否则演示数据本身就违反了状态机联动规则。
  (4, 2, 'found', '捡到一张校园卡', 'card', '下沙校区图书馆一楼大厅',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 293 HOUR),
   '在自动借还机旁边捡到，卡套是黑色的，已交到图书馆前台。', '[]', 'matched',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 288 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 285 HOUR)),

  (5, 2, 'found', '捡到一串钥匙（带小熊挂件）', 'key', '下沙校区食堂二楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 269 HOUR),
   '钥匙串上有一个棕色小熊挂件，共 4 把钥匙。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 264 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 264 HOUR)),

  -- ---------- carol（用户 3） ----------
  (6, 3, 'found', '捡到一个保温杯', 'other', '下沙校区体育馆',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 245 HOUR),
   '银色保温杯，杯身有宿舍楼号贴纸。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 240 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 240 HOUR)),

  -- ---------- 补充到 16 条：覆盖全部 6 个分类与三种状态的交叉组合 ----------
  (7, 2, 'lost', '丢失白色耳机充电盒', 'digital', '下沙校区一教 305',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 221 HOUR),
   '圆形充电盒，盖子内侧有轻微划痕，盒底贴了一张蓝色贴纸。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 216 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 216 HOUR)),

  (8, 3, 'lost', '校园卡丢失（卡套是蓝色的）', 'card', '下沙校区体育馆门口',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 197 HOUR),
   '蓝色卡套，卡面有一道横向折痕，学号尾号 1907。', '[]', 'matched',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 192 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 150 HOUR)),

  (9, 1, 'found', '捡到一副蓝牙耳机', 'digital', '下沙校区图书馆 2 楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 173 HOUR),
   '白色入耳式耳机，放在靠窗的座位上，已交到图书馆失物招领处。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 168 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 168 HOUR)),

  (10, 2, 'lost', '丢失一件黑色外套', 'clothes', '下沙校区篮球场',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 149 HOUR),
   '黑色连帽外套，左袖口有一小块洗不掉的白色漆点，口袋里有张食堂卡。', '[]', 'closed',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 144 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 HOUR)),

  (11, 3, 'lost', '宿舍钥匙串丢失', 'key', '下沙校区 5 号宿舍楼下',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 125 HOUR),
   '两把钥匙，挂着一个金属校徽挂坠，可能掉在快递柜附近。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 HOUR)),

  (12, 1, 'found', '捡到《线性代数》课本', 'book', '下沙校区二教 401',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 101 HOUR),
   '同济版线性代数，扉页写着班级，内页夹了一张草稿纸。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 96 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 96 HOUR)),

  (13, 2, 'found', '捡到一把雨伞（已归还）', 'other', '下沙校区食堂一楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 77 HOUR),
   '深蓝色折叠伞，伞柄上缠了一圈黄色胶带，失主已联系取回。', '[]', 'closed',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 72 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 HOUR)),

  (14, 3, 'found', '捡到一张校园卡（带黑色卡套）', 'card', '下沙校区图书馆一楼',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 53 HOUR),
   '在自助借还机旁捡到，黑色卡套，卡面姓名被贴纸挡住了一半。', '[]', 'open',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 48 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 48 HOUR)),

  (15, 1, 'lost', '丢失银色保温杯', 'other', '下沙校区体育馆',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 29 HOUR),
   '500ml 银色保温杯，杯盖有一道裂纹，已联系上捡到的同学。', '[]', 'matched',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 HOUR)),

  (16, 2, 'found', '捡到一副 AirPods 耳机', 'digital', '下沙校区三教 202',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 11 HOUR),
   '在最后一排课桌抽屉里捡到，充电盒背面刻了三个字母。', '[]', 'matched',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR));

-- ============================ 认领记录 ============================
-- 2 条：1 条 pending（待审核）、1 条 approved（已通过，带凭证码）。
-- 两条都挂在 found 帖上，符合 SPEC 7.3「只有 found 帖可被认领」，
-- 且 claimant 与帖主不同人，符合「不能认领自己发的帖子」。
INSERT INTO claims (id, post_id, claimant_id, proof, status, voucher_code, reject_reason, reviewed_at, created_at) VALUES
  -- alice 认领 bob 的 5 号「捡到钥匙」帖 —— pending，待 bob 审核
  (1, 5, 1, '钥匙串上确实有棕色小熊挂件，第 3 把钥匙刻了"302"字样，是我宿舍门钥匙。',
   'pending', NULL, '', NULL,
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 262 HOUR)),

  -- alice 认领 bob 的 4 号「捡到校园卡」帖 —— approved（带凭证码）
  -- 对应帖子已按 SPEC 7.1 的联动规则 open → matched（见上方 4 号帖的 status）
  (2, 4, 1, '卡套背面确实有皮卡丘贴纸，我的学号尾号是 0421。',
   'approved', 'K7M2QX', '',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 285 HOUR),
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 286 HOUR));
