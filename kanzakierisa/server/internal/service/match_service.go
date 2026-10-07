package service

import (
	"context"
	"sort"
	"time"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/similar"
	"hdu-lostfound/internal/pkg/valid"
	"hdu-lostfound/internal/store"
)

// 匹配打分的四个维度与分值（SPEC 7.4）。写成常量而不是散在代码里的字面量：
// 这些数字会出现在 reasons 文案里，前端与文档都引用同一套语义，
// 改分值时只可能改一处。
const (
	scoreCategory = 40 // 分类相同
	scoreLocation = 30 // 地点关键词重合
	scoreTime     = 20 // 时间接近（≤24h）
	scoreTitle    = 10 // 标题关键词重合
)

// matchThreshold 是「视为可能匹配」的总分下限（SPEC 7.4）。
//
// 60 分意味着至少命中两个维度（40+30 / 40+20 / 30+20+10 等组合），
// 单独一个维度（最高 40）永远不够 —— 这恰好过滤掉「分类相同就推给你」
// 这种最廉价的假阳性：全校的校园卡帖分类都相同。
const matchThreshold = 60

// matchMaxResults 是返回条数上限（SPEC 7.4）。
const matchMaxResults = 5

// matchCandidateLimit 是参与打分的候选数量上限（07 第二部分 §2）。
const matchCandidateLimit = 200

// matchTimeWindow 是「时间接近」的判定窗口。
const matchTimeWindow = 24 * time.Hour

// MatchResult 是单条匹配结果（07 第二部分 §2）。
//
// Reason 数组是这个功能的**卖点**，不是装饰：
// 系统给出「这张帖子 87 分」时，用户唯一会问的问题是「凭什么」。
// 把「分类相同 +40 / 地点吻合 +30」直接摊开，用户能立刻判断这个匹配
// 值不值得点进去；没有 reasons 的黑箱推荐只会被当作噪音忽略。
//
// Post 用 *model.PostDTO 而不是 07 里写的 *model.Post：
//
//	SQL 实体上没有 json tag，直接序列化会输出 Go 的字段名（ID、UserID…），
//	既不符合 SPEC 8.3 的契约，也会顺带把 AuthorContact 这类内部字段带出去。
//	DTO 走的是与列表/详情完全相同的裁剪逻辑，形状一致、责任清晰。
type MatchResult struct {
	Post    *model.PostDTO `json:"post"`
	Score   int            `json:"score"`
	Reasons []string       `json:"reasons"`
}

// MatchService 实现规则相似度版的「AI 智能匹配」。
//
// 特意不叫 AIService：这里没有模型、没有向量，只有四个可解释的规则
// 加分。把名字叫准，读代码的人就不会以为背后有什么黑盒。
type MatchService struct {
	posts *store.PostStore
}

// NewMatchService 创建匹配服务。
func NewMatchService(posts *store.PostStore) *MatchService {
	return &MatchService{posts: posts}
}

// FindMatches 找出与指定帖子可能匹配的帖子列表（SPEC 7.4）。
//
// 流程：
//  1. 查目标帖 → 不存在 1004；
//  2. 查类型相反且 status = 'open' 的候选（最多 200 条，按发布时间倒序）；
//  3. 逐条打分（分类 40 / 地点 30 / 时间 20 / 标题 10）；
//  4. 保留 score ≥ 60；
//  5. 按 score DESC、happened_at DESC 排序，取前 5。
//
// view 由 handler 传入（软鉴权：游客也能看），用于组装候选帖的 DTO ——
// 匹配结果里同样按「列表口径」处理联系方式（一律为空串）。
func (s *MatchService) FindMatches(ctx context.Context, postID int64, view model.PostView) ([]*MatchResult, error) {
	// viewerID 传 0：本流程只需要目标帖的类型来做反向匹配，
	// 联系方式与可见性判定与打分无关。
	target, err := s.posts.GetByID(ctx, postID, 0)
	if err != nil {
		return nil, err
	}

	opposite := oppositeType(target.Type)
	if opposite == "" {
		// 库里的 type 不在枚举内：属于数据异常。返回空列表而不是报错 ——
		// 匹配是详情页的附加区块，没有理由因为它把整页带崩。
		return []*MatchResult{}, nil
	}

	candidates, err := s.posts.ListMatchCandidates(ctx, target.ID, opposite, view.ViewerID, matchCandidateLimit)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 组装结果时统一用「列表口径」：不返回联系方式。
	// 就算请求者是登录用户也一样 —— 匹配区块的作用是导流到对方详情页，
	// 让对方详情页按完整规则去决定联系方式是否可见，
	// 而不是在这里开一个旁路（那会让 SPEC 7.2 的 SQL 层判定形同虚设）。
	candidateView := model.PostView{ViewerID: view.ViewerID, InList: true}

	// 先收集「命中的候选 + 分数」，排序之后再转 DTO。
	//
	// 为什么不在 DTO 上排序：DTO 里的 happened_at 是 RFC3339 **字符串**，
	// 拿字符串当时间比较是能跑通的（同为 UTC 时字典序等于时间序），
	// 但那依赖「格式恒定、长度一致」这个隐含前提 ——
	// 哪天有人换了时间格式，排序就静默错乱且极难发现。
	// 排序键继续用 time.Time，前提被消灭，而不是被注释保护。
	type hit struct {
		post    *model.Post
		score   int
		reasons []string
	}

	hits := make([]hit, 0, matchMaxResults)
	for i := range candidates {
		score, reasons := s.score(target, &candidates[i])
		if score < matchThreshold {
			continue
		}
		hits = append(hits, hit{post: &candidates[i], score: score, reasons: reasons})
	}

	// 稳定排序：同分时按 happened_at 倒序（SPEC 7.4「排序需稳定」）。
	// 一级键是分数（高的在前），二级键是发生时间（新的在前）——
	// 同分的情况下，「刚丢/刚捡」的那条更可能是当事人关心的。
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return hits[i].post.HappenedAt.After(hits[j].post.HappenedAt)
	})

	if len(hits) > matchMaxResults {
		hits = hits[:matchMaxResults]
	}

	results := make([]*MatchResult, 0, len(hits))
	for _, h := range hits {
		results = append(results, &MatchResult{
			Post:    model.ToPostDTO(h.post, candidateView),
			Score:   h.score,
			Reasons: h.reasons,
		})
	}
	return results, nil
}

// score 按 SPEC 7.4 的打分表计算总分与理由。
//
// 与 target 逐维度比较，命中即加分并把对应的解释文案追加进 reasons。
// reasons 的顺序固定为「分值从高到低」，前端直接按顺序渲染标签即可，
// 不需要再排一次 —— 最高分的理由排在最前，最能帮用户快速判断。
func (s *MatchService) score(target, candidate *model.Post) (int, []string) {
	score := 0
	reasons := make([]string, 0, 4)

	// 分类相同：+40。
	//
	// 两个附加条件（SPEC 7.4 表格的备注）：
	//   - 不为空：空分类说明数据缺失，不该当成一次「相同」；
	//   - 不为 other：「其他」是一个兜底桶，把两条都归到 other 的帖子
	//     判为同一类毫无信息量 —— 它们是「没法分类」而不是「同一类」。
	if target.Category != "" && target.Category != valid.CategoryOther &&
		target.Category == candidate.Category {
		score += scoreCategory
		reasons = append(reasons, "分类相同 +40")
	}

	// 地点关键词重合：+30。中文 2-gram 集合求交集，非空即得分。
	if similar.Overlap(similar.Bigrams(target.Location), similar.Bigrams(candidate.Location)) {
		score += scoreLocation
		reasons = append(reasons, "地点吻合 +30")
	}

	// 时间接近：+20。两者 happened_at 的绝对差 ≤ 24h。
	//
	// 用 happened_at 而不是 created_at：丢东西和捡东西的时刻才是
	// 物理上有关联的，发帖时间取决于用户什么时候想起来发。
	if diff := target.HappenedAt.Sub(candidate.HappenedAt); absDuration(diff) <= matchTimeWindow {
		score += scoreTime
		reasons = append(reasons, "时间接近 +20")
	}

	// 标题关键词重合：+10。
	if similar.Overlap(similar.Bigrams(target.Title), similar.Bigrams(candidate.Title)) {
		score += scoreTitle
		reasons = append(reasons, "标题相似 +10")
	}

	return score, reasons
}

// oppositeType 返回与给定类型相反的类型，用于「lost 找 found」。
//
// 未知类型返回空串而不是随便给一个：调用方据此走「数据异常」分支，
// 比返回一个看似合法的默认值更安全 —— 后者会让脏数据表现成
// 「匹配结果莫名其妙」，排查成本高得多。
func oppositeType(t string) string {
	switch t {
	case valid.TypeLost:
		return valid.TypeFound
	case valid.TypeFound:
		return valid.TypeLost
	default:
		return ""
	}
}

// absDuration 返回 time.Duration 的绝对值。
//
// time 包没有内置的 Abs，而「时间差 ≤ 24h」必须对两个方向都成立 ——
// 候选帖比目标帖早或晚 23 小时，都算「时间接近」。
func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}
