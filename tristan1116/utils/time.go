package utils

import (
	"fmt"
	"time"
)

// timeLayouts 前端可能传来的几种时间格式，挨个尝试
// Go 的时间格式不用 yyyy-MM-dd，而是用"参考时间" 2006-01-02 15:04:05 来当模板（记住这个数就行）
var timeLayouts = []string{
	time.RFC3339,          // 2026-09-26T14:30:00+08:00
	"2006-01-02T15:04:05", // 2026-09-26T14:30:00
	"2006-01-02T15:04",    // 2026-09-26T14:30（<input type="datetime-local"> 的原生格式）
	"2006-01-02 15:04:05", // 2026-09-26 14:30:00
	"2006-01-02 15:04",    // 2026-09-26 14:30
	"2006-01-02",          // 2026-09-26
}

// ParseTime 把前端传来的时间字符串解析成 time.Time
func ParseTime(s string) (time.Time, error) {
	for _, layout := range timeLayouts {
		// ParseInLocation：按本地时区解析（不加这个，时间会差 8 小时）
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("无法识别的时间格式: %s", s)
}
