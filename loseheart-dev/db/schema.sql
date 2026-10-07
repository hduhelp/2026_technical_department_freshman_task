-- 杭电校园失物招领 MVP；目标 MySQL 8.4 / InnoDB。
-- 由部署步骤先创建空数据库 lost_found，再执行本文件。
-- 每个应用连接都必须设置 UTC；事件日期/时间与配额日期采用北京时间语义。
-- 不包含账户种子、凭证、DROP TABLE 或对现有业务数据库的修改。
SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_no VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '模拟学号/职工号，保留前导零',
    identity_type ENUM('student', 'staff') NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    avatar_url VARCHAR(512) NULL COMMENT '预置头像或默认头像；不能作为任意代理读取地址',
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Argon2id PHC 字符串，含版本、参数、盐、哈希',
    token_version BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'JWT 登录版本；退出、密码修改/重置、禁用时递增使全部旧令牌失效',
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE COMMENT '模拟校园身份已由项目管理员预置验证',
    wechat_appid VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    wechat_openid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    wechat_bound_at DATETIME(3) NULL,
    password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_account_no (account_no),
    UNIQUE KEY uk_users_wechat (wechat_appid, wechat_openid),
    CONSTRAINT ck_users_account_no CHECK (CHAR_LENGTH(TRIM(account_no)) > 0),
    CONSTRAINT ck_users_nickname CHECK (CHAR_LENGTH(TRIM(nickname)) > 0),
    CONSTRAINT ck_users_password_hash CHECK (CHAR_LENGTH(password_hash) > 0),
    CONSTRAINT ck_users_token_version CHECK (token_version > 0),
    CONSTRAINT ck_users_flags CHECK (must_change_password IN (0, 1) AND is_verified IN (0, 1)),
    CONSTRAINT ck_users_wechat CHECK (
        (wechat_appid IS NULL AND wechat_openid IS NULL AND wechat_bound_at IS NULL)
        OR (wechat_appid IS NOT NULL AND wechat_openid IS NOT NULL AND wechat_bound_at IS NOT NULL
            AND CHAR_LENGTH(wechat_appid) > 0 AND CHAR_LENGTH(wechat_openid) > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE posts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    author_id BIGINT UNSIGNED NOT NULL,
    post_type ENUM('lost', 'found') NOT NULL,
    item_name VARCHAR(50) NOT NULL,
    campus ENUM('xiasha', 'shaoxing', 'wenyi') NOT NULL,
    location VARCHAR(100) NOT NULL,
    event_date DATE NOT NULL COMMENT '丢失/拾获的北京时间日期',
    time_precision ENUM('date', 'exact', 'range') NOT NULL DEFAULT 'date',
    event_time_start TIME NULL,
    event_time_end TIME NULL COMMENT 'range 使用同日时间段，exact 仅使用 start',
    description VARCHAR(300) NOT NULL,
    images JSON NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '有序 OSS Object Key 数组，最多 6 张；空数组表示无图，第一张为封面',
    contact_methods JSON NOT NULL COMMENT '[{"type":"wechat","value":"..."}]，至少一种',
    review_status ENUM('pending', 'approved', 'returned', 'rejected', 'removed') NOT NULL DEFAULT 'pending',
    resolution_status ENUM('active', 'completed', 'withdrawn') NOT NULL DEFAULT 'active',
    revision INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '内容每次重新提交+1；完成/撤回操作不增加内容版本',
    state_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '任何帖子变更+1，用于乐观并发控制',
    review_reason VARCHAR(500) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(3) NULL,
    submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '本次内容提交时间，审核队列按此排序',
    first_published_at DATETIME(3) NULL COMMENT '首次通过审核时间，重审不刷新排序时间',
    completed_at DATETIME(3) NULL,
    withdrawn_at DATETIME(3) NULL,
    creation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '创建请求 UUID，重复提交返回原帖',
    creation_payload_hash BINARY(32) NOT NULL COMMENT '原始规范化创建参数 SHA-256，防止同 key 不同内容',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_posts_creation (author_id, creation_key),
    KEY ix_posts_feed (review_status, resolution_status, first_published_at DESC, id DESC),
    KEY ix_posts_campus_type (campus, post_type, review_status, resolution_status, first_published_at DESC, id DESC),
    KEY ix_posts_author (author_id, created_at DESC, id DESC),
    KEY ix_posts_pending (review_status, submitted_at, id),
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users (id),
    CONSTRAINT fk_posts_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id),
    CONSTRAINT ck_posts_text CHECK (
        CHAR_LENGTH(TRIM(item_name)) > 0 AND CHAR_LENGTH(TRIM(location)) > 0
        AND CHAR_LENGTH(TRIM(description)) > 0
    ),
    CONSTRAINT ck_posts_version CHECK (revision > 0 AND state_version > 0),
    CONSTRAINT ck_posts_images CHECK (JSON_SCHEMA_VALID(
        '{"type":"array","maxItems":6,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":512}}',
        images
    )),
    CONSTRAINT ck_posts_time CHECK (
        (time_precision = 'date' AND event_time_start IS NULL AND event_time_end IS NULL)
        OR (time_precision = 'exact' AND event_time_start IS NOT NULL AND event_time_end IS NULL
            AND event_time_start >= '00:00:00' AND event_time_start < '24:00:00')
        OR (time_precision = 'range' AND event_time_start IS NOT NULL AND event_time_end IS NOT NULL
            AND event_time_start >= '00:00:00' AND event_time_start <= event_time_end
            AND event_time_end < '24:00:00')
    ),
    CONSTRAINT ck_posts_contacts CHECK (JSON_SCHEMA_VALID(
        '{"type":"array","minItems":1,"items":{"type":"object","required":["type","value"],"additionalProperties":false,"properties":{"type":{"type":"string","enum":["wechat","phone","qq","other"]},"value":{"type":"string","minLength":1,"maxLength":200}}}}',
        contact_methods
    )),
    CONSTRAINT ck_posts_resolution CHECK (
        (resolution_status = 'active' AND completed_at IS NULL AND withdrawn_at IS NULL)
        OR (resolution_status = 'completed' AND completed_at IS NOT NULL AND withdrawn_at IS NULL)
        OR (resolution_status = 'withdrawn' AND withdrawn_at IS NOT NULL)
    ),
    CONSTRAINT ck_posts_review CHECK (
        (review_status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
        OR (review_status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND first_published_at IS NOT NULL)
        OR (review_status IN ('returned', 'rejected', 'removed') AND reviewed_by IS NOT NULL
            AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND CHAR_LENGTH(TRIM(review_reason)) > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE post_daily_quotas (
    user_id BIGINT UNSIGNED NOT NULL,
    quota_date DATE NOT NULL COMMENT '北京时间自然日，无需定时清零',
    submitted_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, quota_date),
    CONSTRAINT fk_quotas_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT ck_quotas_count CHECK (submitted_count <= 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE post_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    post_id BIGINT UNSIGNED NOT NULL,
    revision INT UNSIGNED NOT NULL,
    decision ENUM('pending', 'approved', 'returned', 'rejected', 'superseded') NOT NULL DEFAULT 'pending',
    content_snapshot JSON NOT NULL COMMENT '提交时由后端生成的完整内容、联系方式、图片对象标识快照；提交后不可修改',
    reviewer_id BIGINT UNSIGNED NULL,
    reason VARCHAR(500) NULL,
    submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    processed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_reviews_revision (post_id, revision),
    KEY ix_reviews_queue (decision, submitted_at, id),
    CONSTRAINT fk_reviews_post FOREIGN KEY (post_id) REFERENCES posts (id),
    CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id),
    CONSTRAINT ck_reviews_snapshot CHECK (JSON_TYPE(content_snapshot) = 'OBJECT'),
    CONSTRAINT ck_reviews_revision CHECK (revision > 0),
    CONSTRAINT ck_reviews_decision CHECK (
        (decision = 'pending' AND reviewer_id IS NULL AND processed_at IS NULL AND reason IS NULL)
        OR (decision = 'superseded' AND reviewer_id IS NULL AND processed_at IS NOT NULL)
        OR (decision = 'approved' AND reviewer_id IS NOT NULL AND processed_at IS NOT NULL)
        OR (decision IN ('returned', 'rejected') AND reviewer_id IS NOT NULL AND processed_at IS NOT NULL
            AND reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE post_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reporter_id BIGINT UNSIGNED NOT NULL,
    post_id BIGINT UNSIGNED NOT NULL,
    post_revision INT UNSIGNED NOT NULL COMMENT '举报时的内容版本，不会随帖子修改漂移',
    reason_type ENUM('false_information', 'inappropriate', 'privacy', 'harassment', 'other') NOT NULL,
    details VARCHAR(500) NULL,
    status ENUM('pending', 'handled', 'dismissed') NOT NULL DEFAULT 'pending',
    result_action ENUM('none', 'remove_post', 'disable_user') NULL,
    handler_id BIGINT UNSIGNED NULL,
    handling_reason VARCHAR(500) NULL,
    handled_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_reports_user_revision (reporter_id, post_id, post_revision),
    KEY ix_reports_queue (status, created_at, id),
    KEY ix_reports_post (post_id, post_revision),
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id),
    CONSTRAINT fk_reports_revision FOREIGN KEY (post_id, post_revision) REFERENCES post_reviews (post_id, revision),
    CONSTRAINT fk_reports_handler FOREIGN KEY (handler_id) REFERENCES users (id),
    CONSTRAINT ck_reports_other CHECK (reason_type <> 'other' OR (details IS NOT NULL AND CHAR_LENGTH(TRIM(details)) > 0)),
    CONSTRAINT ck_reports_result CHECK (
        (status = 'pending' AND result_action IS NULL AND handler_id IS NULL AND handling_reason IS NULL AND handled_at IS NULL)
        OR (status IN ('handled', 'dismissed') AND result_action IS NOT NULL AND handler_id IS NOT NULL
            AND handling_reason IS NOT NULL AND CHAR_LENGTH(TRIM(handling_reason)) > 0 AND handled_at IS NOT NULL
            AND ((status = 'dismissed' AND result_action = 'none')
                OR (status = 'handled' AND result_action IN ('remove_post', 'disable_user'))))
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    type ENUM('post_review', 'post_removed', 'report_result', 'account_status', 'password_reset') NOT NULL,
    title VARCHAR(100) NOT NULL,
    content VARCHAR(500) NOT NULL COMMENT '不含密码、密钥、JWT 或完整联系方式',
    post_id BIGINT UNSIGNED NULL,
    review_id BIGINT UNSIGNED NULL,
    report_id BIGINT UNSIGNED NULL,
    read_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_notifications_inbox (user_id, read_at, created_at DESC, id DESC),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES posts (id),
    CONSTRAINT fk_notifications_review FOREIGN KEY (review_id) REFERENCES post_reviews (id),
    CONSTRAINT fk_notifications_report FOREIGN KEY (report_id) REFERENCES post_reports (id),
    CONSTRAINT ck_notifications_text CHECK (CHAR_LENGTH(TRIM(title)) > 0 AND CHAR_LENGTH(TRIM(content)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admin_operation_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    operator_id BIGINT UNSIGNED NOT NULL,
    action ENUM('approve_post', 'return_post', 'reject_post', 'remove_post', 'handle_report', 'dismiss_report', 'disable_user', 'reset_password') NOT NULL,
    target_user_id BIGINT UNSIGNED NULL,
    target_post_id BIGINT UNSIGNED NULL,
    target_report_id BIGINT UNSIGNED NULL,
    reason VARCHAR(500) NOT NULL,
    state_before JSON NOT NULL COMMENT '仅状态白名单，不保存密码哈希、令牌或联系方式',
    state_after JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_admin_logs_time (created_at DESC, id DESC),
    KEY ix_admin_logs_operator (operator_id, created_at DESC),
    CONSTRAINT fk_logs_operator FOREIGN KEY (operator_id) REFERENCES users (id),
    CONSTRAINT fk_logs_user FOREIGN KEY (target_user_id) REFERENCES users (id),
    CONSTRAINT fk_logs_post FOREIGN KEY (target_post_id) REFERENCES posts (id),
    CONSTRAINT fk_logs_report FOREIGN KEY (target_report_id) REFERENCES post_reports (id),
    CONSTRAINT ck_logs_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
    CONSTRAINT ck_logs_target CHECK (target_user_id IS NOT NULL OR target_post_id IS NOT NULL OR target_report_id IS NOT NULL),
    CONSTRAINT ck_logs_state CHECK (JSON_TYPE(state_before) = 'OBJECT' AND JSON_TYPE(state_after) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
