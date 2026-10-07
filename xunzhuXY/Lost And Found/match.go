package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type MatchResult struct {
	ItemID  int    `json:"item_id"`
	Verdict string `json:"verdict"`
	Reason  string `json:"reason"`
}

const (
	llmBaseURL = "https://api.deepseek.com/chat/completions"
	llmModel   = "deepseek-v4-flash"
)

func askLLM(prompt string) (string, error) {
	apiKey := os.Getenv("LLM_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("没配 LLM_API_KEY")
	}

	body := map[string]any{
		"model":    llmModel,
		"messages": []map[string]string{{"role": "user", "content": prompt}},
	}

	bs, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", llmBaseURL, bytes.NewReader(bs))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 30 * time.Second} // ★★ 必须设超时
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != 200 {
		var e struct {
			Error struct{ Message string } `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&e)
		if e.Error.Message != "" {
			return "", fmt.Errorf("API %d: %s", resp.StatusCode, e.Error.Message)
		}
		return "", fmt.Errorf("API 返回 %d", resp.StatusCode)
	}

	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("返回里没有 choices")
	}
	return out.Choices[0].Message.Content, nil
}

func buildMatchPrompt(target Item, candidates []Item) string {
	var b strings.Builder
	b.WriteString(matchPrompt)

	b.WriteString("\n## 目标帖\n")
	fmt.Fprintf(&b, "type=%s\n标题：%s\n描述：%s\n地点：%s\n时间：%s\n",
		target.Type, target.Title, target.Description, target.Place, target.HappenedAt)

	b.WriteString("\n## 候选帖\n")
	for i, it := range candidates {
		fmt.Fprintf(&b, "[候选%d] item_id=%d\ntype=%s\n标题：%s\n描述：%s\n地点：%s\n时间：%s\n\n",
			i+1, it.ItemID, it.Type, it.Title, it.Description, it.Place, it.HappenedAt)
	}
	return b.String()
}

func parseMatches(reply string) ([]MatchResult, error) {
	s := strings.TrimSpace(reply)
	s = strings.TrimPrefix(s, "```json") // ★ 剥代码块
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		s = s[i : j+1] // ★ 只取第一个 { 到最后一个 }
	}

	var out struct {
		Matches []MatchResult `json:"matches"`
	}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, fmt.Errorf("解析失败: %v\n原文: %s", err, reply)
	}
	return out.Matches, nil
}

func reverseOf(t string) string {
	if t == "招领" {
		return "丢失"
	}
	return "招领"
}
