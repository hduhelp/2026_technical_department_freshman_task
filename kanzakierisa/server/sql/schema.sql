-- 把本次会话的时区钉在 UTC。
--
-- 为什么必须写：users / posts / claims 的 created_at、updated_at 用的是
-- DEFAULT CURRENT_TIMESTAMP，MySQL 按**会话时区**求值。若会话时区是 SYSTEM
-- （本机为 +08），写进库的就是本地墙上时间，而 Go 侧 DSN 用 loc=UTC 解析，
-- 结果整整快 8 小时（SPEC 第 6 章要求「所有时间字段存 UTC」）。
-- 应用侧的连接已经在 DSN 里指定 time_zone='+00:00'，这里保证直接用 SQL 导入时同样成立。
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS lost_found
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lost_found;

DROP TABLE IF EXISTS claims;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(32)  NOT NULL                COMMENT '登录名',
  password_hash  VARCHAR(100) NOT NULL                COMMENT 'bcrypt 哈希，绝不存明文',
  nickname       VARCHAR(32)  NOT NULL DEFAULT ''     COMMENT '展示名',
  contact        VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT 'QQ/微信/手机',
  contact_public TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '1=联系方式对所有登录用户公开',
  role           VARCHAR(16)  NOT NULL DEFAULT 'user' COMMENT 'user | admin',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(8)   NOT NULL               COMMENT 'lost=丢失寻找 | found=捡到招领',
  title       VARCHAR(64)  NOT NULL,
  category    VARCHAR(16)  NOT NULL DEFAULT 'other'
              COMMENT 'card|digital|book|key|clothes|other',
  location    VARCHAR(64)  NOT NULL DEFAULT '',
  happened_at DATETIME     NOT NULL               COMMENT '丢失/拾到时间',
  description TEXT,
  images      JSON         NULL                   COMMENT '图片 URL 数组',
  status      VARCHAR(16)  NOT NULL DEFAULT 'open' COMMENT 'open|matched|closed',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_type_status (type, status),
  KEY idx_category (category),
  KEY idx_created (created_at),
  KEY idx_user (user_id),
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE claims (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id       BIGINT UNSIGNED NOT NULL,
  claimant_id   BIGINT UNSIGNED NOT NULL,
  proof         TEXT        NOT NULL              COMMENT '物品特征证明',
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                COMMENT 'pending|approved|rejected|redeemed',
  voucher_code  VARCHAR(16) NULL                  COMMENT '审核通过时生成的 6 位凭证码',
  reject_reason VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_at   DATETIME    NULL,
  redeemed_at   DATETIME    NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_flag TINYINT GENERATED ALWAYS AS (IF(status IN ('approved','redeemed'), 1, NULL)) STORED
                COMMENT '技巧：配合唯一索引实现「一个帖子最多一条通过记录」',
  PRIMARY KEY (id),
  UNIQUE KEY uk_voucher_code (voucher_code),
  UNIQUE KEY uk_post_claimant (post_id, claimant_id),
  UNIQUE KEY uk_post_approved (post_id, approved_flag),
  KEY idx_post_status (post_id, status),
  KEY idx_claimant (claimant_id),
  CONSTRAINT fk_claims_post FOREIGN KEY (post_id)     REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_claims_user FOREIGN KEY (claimant_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
