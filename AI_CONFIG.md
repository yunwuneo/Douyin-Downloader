# AI功能配置说明

本文档详细说明AI功能的所有配置选项。

## 配置方式

所有配置通过环境变量（`.env`文件）进行设置。

## 配置分类

### 1. 基础配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `ENABLE_AI` | boolean | `false` | 是否启用AI功能 |
| `FRAMES_PER_VIDEO` | integer | `5` | 每个视频提取的帧数 |
| `AI_DAILY_SCHEDULE_TIME` | string | `18:00` | 每日总结发送时间，格式 `HH:MM` |

### 2. OpenAI API基础配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | string | - | **必需** API密钥（可以是OpenAI或兼容服务商的密钥） |
| `OPENAI_API_BASE` | string | `https://api.openai.com/v1` | **重要** API基础URL，支持切换到其他OpenAI API兼容的服务商 |
| `OPENAI_ORGANIZATION_ID` | string | - | 组织ID（可选，多账户管理） |
| `OPENAI_MODEL` | string | `gpt-4o` | 模型名称（根据服务商支持情况选择） |

**`OPENAI_API_BASE` 使用说明**：
- 默认使用OpenAI官方API：`https://api.openai.com/v1`
- **支持切换到任何OpenAI API兼容的服务商**，只需修改此URL即可
- 常见兼容服务商示例：
  - **火山引擎**：`https://ark.cn-beijing.volces.com/api/v3`
  - **阿里云通义千问**：`https://dashscope.aliyuncs.com/compatible-mode/v1`
  - **Azure OpenAI**：`https://your-resource.openai.azure.com/`
  - **其他OpenAI兼容服务**：根据服务商文档设置

**注意**：
- 切换到兼容服务商时，请确保服务商支持Vision API（图像分析功能）
- 模型名称可能需要根据服务商进行调整
- 部分服务商可能有特殊的认证方式或请求头要求

**支持的模型**：
- `gpt-4o` - 最新模型，推荐（速度快、质量高）
- `gpt-4o-mini` - 轻量版本，成本更低
- `gpt-4-turbo` - 平衡版本
- `gpt-4-vision-preview` - 专门的视觉模型
- `gpt-4` - 标准版本
- `gpt-3.5-turbo` - 最便宜但质量较低（不推荐用于视觉分析）

### 3. OpenAI API参数配置

这些参数控制AI模型的输出行为：

| 变量名 | 类型 | 默认值 | 范围 | 说明 |
|--------|------|--------|------|------|
| `OPENAI_TEMPERATURE` | float | `0.7` | 0-2 | 温度参数，控制输出随机性。0=确定性，2=非常随机 |
| `OPENAI_MAX_TOKENS` | integer | `1000` | 1-4096 | 最大token数，控制响应长度 |
| `OPENAI_TOP_P` | float | `1.0` | 0-1 | Top-p采样，控制多样性。1=使用所有可能token |
| `OPENAI_FREQUENCY_PENALTY` | float | `0.0` | -2.0 to 2.0 | 频率惩罚，降低重复内容。正值=减少重复 |
| `OPENAI_PRESENCE_PENALTY` | float | `0.0` | -2.0 to 2.0 | 存在惩罚，鼓励新话题。正值=鼓励新内容 |

### 4. OpenAI Vision API配置

这些参数专门用于图像分析：

| 变量名 | 类型 | 默认值 | 选项 | 说明 |
|--------|------|--------|------|------|
| `OPENAI_VISION_DETAIL` | string | `high` | `low`, `high` | 图片分析详细度 |
| `OPENAI_VISION_LOW_DETAIL_MAX_TOKENS` | integer | `85` | - | 低详细度时最大token数 |
| `OPENAI_VISION_HIGH_DETAIL_MAX_TOKENS` | integer | `170` | - | 高详细度时最大token数 |

**Vision详细度说明**：
- `low`: 快速分析，细节较少，消耗约85 tokens，适合批量处理
- `high`: 详细分析，更多细节，消耗约170 tokens，推荐用于重要内容

### 5. 请求控制配置

这些参数控制API请求的行为：

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `OPENAI_TIMEOUT` | integer | `60000` | 请求超时时间（毫秒），默认60秒 |
| `OPENAI_REQUEST_DELAY` | integer | `500` | 请求之间的延迟（毫秒），避免速率限制 |
| `OPENAI_MAX_RETRIES` | integer | `3` | 最大重试次数，自动重试失败的请求 |
| `OPENAI_RETRY_DELAY` | integer | `1000` | 重试延迟（毫秒），使用指数退避策略 |
| `OPENAI_CONCURRENCY` | integer | `1` | 并发请求数，注意API速率限制 |
| `OPENAI_PROXY` | string | - | 代理服务器地址（可选） |

**代理格式示例**：
```
OPENAI_PROXY=http://proxy.example.com:8080
OPENAI_PROXY=http://username:password@proxy.example.com:8080
OPENAI_PROXY=socks5://proxy.example.com:1080
```

### 6. 备用AI服务配置

如果不想使用OpenAI，可以配置其他AI服务：

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `USE_LOCAL_AI` | boolean | `false` | 是否使用本地AI服务 |
| `LOCAL_AI_SERVICE` | string | - | 本地AI服务地址 |
| `LOCAL_AI_TIMEOUT` | integer | `60000` | 本地AI服务超时时间（毫秒） |
| `USE_CLAUDE` | boolean | `false` | 是否使用Claude API |
| `CLAUDE_API_KEY` | string | - | Claude API密钥 |
| `CLAUDE_API_BASE` | string | `https://api.anthropic.com/v1` | Claude API基础URL |
| `CLAUDE_MODEL` | string | `claude-3-opus-20240229` | Claude模型名称 |

**本地AI服务示例**：
```
USE_LOCAL_AI=true
LOCAL_AI_SERVICE=http://localhost:11434/v1/chat/completions
```

### 7. 调试和日志配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `AI_DEBUG` | boolean | `false` | 是否启用调试日志，输出详细调试信息 |
| `AI_LOG_REQUESTS` | boolean | `false` | 是否记录请求日志，记录所有API请求 |

### 8. Web UI配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `ENABLE_WEBUI` | boolean | `true` | 是否启用Web UI服务器 |
| `WEBUI_PORT` | integer | `3001` | Web UI服务器端口 |
| `WEBUI_SECRET` | string | `default-secret-change-me` | **请修改** Web UI访问密钥 |
| `WEBUI_BASE_URL` | string | `http://localhost:3001` | Web UI基础URL（用于邮件中的链接） |

### 9. 邮件服务配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `EMAIL_FROM` | string | - | 发件人邮箱地址 |
| `EMAIL_TO` | string | - | 收件人邮箱地址 |
| `EMAIL_HOST` | string | `smtp.gmail.com` | 邮件服务器地址 |
| `EMAIL_PORT` | integer | `587` | 邮件服务器端口（587=TLS，465=SSL） |
| `EMAIL_USER` | string | - | 邮件服务器用户名 |
| `EMAIL_PASSWORD` | string | - | 邮件服务器密码或应用专用密码 |

**Gmail配置示例**：
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password  # 使用应用专用密码，不是账户密码
```

### 10. 偏好学习配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `PREFERENCE_LIKE_WEIGHT` | float | `1.0` | 喜欢视频的权重分数 |
| `PREFERENCE_DISLIKE_WEIGHT` | float | `-1.0` | 不喜欢视频的权重分数 |

## 配置示例

### 最小配置（必需项）

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
EMAIL_TO=your-email@example.com
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-password
```

### 使用兼容服务商配置

#### 火山引擎（VeByte Ark）

```bash
ENABLE_AI=true
OPENAI_API_KEY=your-volces-api-key
OPENAI_API_BASE=https://ark.cn-beijing.volces.com/api/v3
OPENAI_MODEL=gpt-4o  # 根据火山引擎支持的模型调整
# ... 其他配置
```

#### 阿里云通义千问

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-your-dashscope-key
OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-vl-max  # 或根据阿里云支持的模型调整
# ... 其他配置
```

#### Azure OpenAI

```bash
ENABLE_AI=true
OPENAI_API_KEY=your-azure-openai-key
OPENAI_API_BASE=https://your-resource.openai.azure.com/
OPENAI_MODEL=gpt-4-vision  # 或根据Azure支持的模型调整
# ... 其他配置
```

#### 其他兼容服务商

```bash
ENABLE_AI=true
OPENAI_API_KEY=your-service-api-key
OPENAI_API_BASE=https://your-service-endpoint.com/v1  # 根据服务商文档设置
OPENAI_MODEL=your-model-name  # 根据服务商支持的模型调整
# ... 其他配置
```

**提示**：
- 使用兼容服务商时，请参考服务商的官方文档获取正确的API地址和模型名称
- 确保服务商支持Vision API（图像分析功能）
- 某些服务商可能需要额外的请求头或认证参数

### 推荐配置（平衡性能和成本）

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o
OPENAI_VISION_DETAIL=high
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=1000
OPENAI_REQUEST_DELAY=500
OPENAI_CONCURRENCY=1
FRAMES_PER_VIDEO=5
AI_DAILY_SCHEDULE_TIME=18:00
WEBUI_SECRET=your-secure-secret-key
EMAIL_TO=your-email@example.com
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-password
```

### 高成本配置（最佳质量）

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o
OPENAI_VISION_DETAIL=high
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=1500
OPENAI_REQUEST_DELAY=300
FRAMES_PER_VIDEO=8
AI_DAILY_SCHEDULE_TIME=18:00
# ... 其他配置
```

### 低成本配置（节省费用）

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_VISION_DETAIL=low
OPENAI_MAX_TOKENS=500
OPENAI_REQUEST_DELAY=1000
FRAMES_PER_VIDEO=3
# ... 其他配置
```

### 使用代理的配置

```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_PROXY=http://proxy.example.com:8080
OPENAI_TIMEOUT=120000  # 代理可能较慢，增加超时时间
# ... 其他配置
```

## 性能优化建议

1. **模型选择**
   - 优先使用 `gpt-4o`，平衡性能和成本
   - 如果需要节省成本，使用 `gpt-4o-mini`

2. **Vision详细度**
   - 日常使用推荐 `high` 获得更好效果
   - 批量处理或成本敏感场景使用 `low`

3. **并发控制**
   - 建议设置 `OPENAI_CONCURRENCY=1` 避免速率限制
   - 如果API限制较高，可以适当增加

4. **请求延迟**
   - 默认500ms通常足够
   - 如果遇到速率限制，增加到1000-2000ms

5. **帧数设置**
   - 默认5帧通常足够
   - 重要内容可以增加到8-10帧
   - 节省成本可以减少到3帧

## 故障排除

### API调用失败
- 检查API密钥是否正确
- 确认账户余额充足
- 查看API速率限制
- 检查网络连接和代理配置

### 速率限制错误（429）
- 增加 `OPENAI_REQUEST_DELAY`
- 减少 `OPENAI_CONCURRENCY`
- 检查API使用配额

### 超时错误
- 增加 `OPENAI_TIMEOUT`
- 检查网络连接
- 如果使用代理，检查代理速度

### 质量不佳
- 使用更好的模型（如 `gpt-4o`）
- 设置 `OPENAI_VISION_DETAIL=high`
- 增加 `OPENAI_MAX_TOKENS`
- 增加 `FRAMES_PER_VIDEO`

## 成本估算

**示例**：每天下载10个视频，每个视频提取5帧

- **使用 `gpt-4o` + `high` 详细度**：
  - 每次分析：约170 tokens（输入）+ 1000 tokens（输出）= 1170 tokens
  - 每天：10视频 × 5帧 × 1170 tokens = 58,500 tokens
  - 约 $0.01-0.03/天（取决于实际使用）

- **使用 `gpt-4o-mini` + `low` 详细度**：
  - 每次分析：约85 tokens（输入）+ 500 tokens（输出）= 585 tokens
  - 每天：10视频 × 5帧 × 585 tokens = 29,250 tokens
  - 约 $0.001-0.003/天

*注：实际成本取决于OpenAI定价，请参考最新价格*


