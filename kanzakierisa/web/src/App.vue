<script setup>
// P0 阶段的临时页面：唯一目的是验证 Vite proxy → Go 服务是否打通。
// P1 起会被真实路由页面替换。
import { ref } from 'vue'

const loading = ref(false)
const result = ref(null)
const errorText = ref('')

// 走 Vite 代理请求后端健康检查接口。
async function checkHealth() {
  loading.value = true
  result.value = null
  errorText.value = ''
  try {
    const resp = await fetch('/api/health')
    const body = await resp.json()
    result.value = { httpStatus: resp.status, body }
  } catch (e) {
    errorText.value = String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="probe">
    <h1>校园失物招领 · P0 连通性自检</h1>
    <p class="hint">
      点击按钮请求 <code>/api/health</code>，经 Vite 代理转发到
      <code>http://localhost:8080</code>。
    </p>

    <button :disabled="loading" @click="checkHealth">
      {{ loading ? '请求中…' : '调用 /api/health' }}
    </button>

    <p v-if="errorText" class="error">请求失败：{{ errorText }}</p>

    <pre v-if="result">HTTP {{ result.httpStatus }}
{{ JSON.stringify(result.body, null, 2) }}</pre>
  </main>
</template>

<style scoped>
.probe {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 20px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

h1 {
  font-size: 20px;
  margin-bottom: 8px;
}

.hint {
  color: #666;
  font-size: 14px;
  line-height: 1.6;
}

code {
  background: #f2f3f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
}

button {
  margin: 16px 0;
  padding: 10px 20px;
  font-size: 15px;
  color: #fff;
  background: #1989fa;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

button:disabled {
  background: #a0cfff;
  cursor: not-allowed;
}

.error {
  color: #ee0a24;
  font-size: 14px;
}

pre {
  padding: 16px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
}
</style>
