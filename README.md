# 抖音作品监控下载器

这是一个Node.js项目，可以定期监控指定抖音用户发布的作品或点赞的作品，并自动下载包括文字、照片和视频内容。

## 功能特性

- 监控多个抖音用户的发布作品或点赞作品
- 自动下载视频、照片和文字描述
- 支持定时任务，可配置监控间隔
- 使用TikHub API获取抖音数据
- **🤖 AI功能（新增）**：
  - 自动提取视频帧并使用AI分析视频特征
  - 每日定时生成视频下载总结并发送邮件
  - Web UI界面让用户选择喜欢的视频
  - 智能学习用户偏好，优化推荐顺序
  - **支持对已下载视频进行AI分析**：在Web UI首页随机展示未分析的视频，支持按需分析和偏好记录

## 安装步骤

1. 克隆或下载本项目到本地

2. 安装依赖
```bash
npm install
```

3. 配置环境变量
   - 复制 `.env.example` 文件为 `.env`
   - 在 `.env` 文件中填入您的 TikHub API 密钥和其他配置

4. 配置监控用户
   - 编辑 `config.json` 文件
   - 添加要监控的用户信息，包括 sec_user_id 和监控类型（posts或likes）

## 使用方法

启动应用
```bash
npm start
```

## 配置说明

### 环境变量 (.env)
- `API_KEY`: TikHub API 密钥  
- `API_BASE_URL`: API基础URL  
- `DOWNLOAD_DIR`: 下载文件保存目录  
- `DOWNLOAD_VIDEO`: 是否下载视频  
- `DOWNLOAD_PHOTO`: 是否下载照片  
- `DOWNLOAD_CAPTION`: 是否下载文字描述  
- `MONITOR_INTERVAL`: 监控间隔（毫秒）  
- `MONITOR_IGNORE`: 忽略监控的时间段，格式为 `HH:mm-HH:mm`，支持多个时间段用逗号分隔。例如：`22:00-06:00` 表示晚上10点到早上6点不监控，`22:00-06:00,14:00-15:00` 表示多个时间段。所有时间使用 Asia/Shanghai 时区  
- `MAX_RETRY`: 下载失败重试次数  

#### 多存储后端相关
- `STORAGE_BACKENDS`: 启用的存储后端，使用逗号分隔，例如 `local,dropbox,s3`  
  - `local`: 本地磁盘（下载器自身，建议始终保留）  
  - `dropbox`: Dropbox 云存储  
  - `s3`: 亚马逊 S3 或兼容 S3 的对象存储

**Dropbox 配置（可选，支持短期 token + refresh_token）**
- `STORAGE_BACKENDS` 中包含 `dropbox` 才会启用 Dropbox 后端  
- 方案一（旧方式，不推荐）：  
  - `DROPBOX_ACCESS_TOKEN`: Dropbox 静态访问令牌（现在通常为短期 token，数小时后过期，会导致 401 错误）  
- 方案二（推荐）：使用 refresh_token 自动刷新  
  - `DROPBOX_APP_KEY`: Dropbox 应用的 App key  
  - `DROPBOX_APP_SECRET`: Dropbox 应用的 App secret  
  - `DROPBOX_REFRESH_TOKEN`: 通过 OAuth 流程获取的 refresh_token，勾选 offline access  
  - `DROPBOX_BASE_FOLDER`: 保存到 Dropbox 的根目录（默认 `/douyin-downloads`）

**S3 配置（可选）**
- `S3_REGION`: S3 区域，例如 `ap-southeast-1`  
- `S3_BUCKET`: S3 存储桶名称  
- `S3_ACCESS_KEY_ID`: S3 Access Key ID  
- `S3_SECRET_ACCESS_KEY`: S3 Secret Access Key  
- `S3_BASE_PREFIX`: S3 上的基础路径前缀（默认 `douyin-downloads`）

#### AI功能相关（可选）

**基础配置**
- `ENABLE_AI`: 是否启用AI功能，设置为 `true` 启用（默认 `false`）
- `FRAMES_PER_VIDEO`: 每个视频提取的帧数（默认 `5`）
- `AI_DAILY_SCHEDULE_TIME`: 每日总结发送时间，格式 `HH:MM`（默认 `18:00`）

**OpenAI API配置**
- `OPENAI_API_KEY`: API密钥（必需，可以是OpenAI或兼容服务商的密钥）
- `OPENAI_API_BASE`: **重要** API基础URL（默认 `https://api.openai.com/v1`）
  - 支持切换到其他OpenAI API兼容的服务商，只需修改此URL即可
  - **火山引擎示例**：`OPENAI_API_BASE=https://ark.cn-beijing.volces.com/api/v3`
  - **阿里云通义示例**：`OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1`
  - **Azure OpenAI示例**：`OPENAI_API_BASE=https://your-resource.openai.azure.com/`
  - 其他兼容服务商：根据服务商文档设置
- `OPENAI_ORGANIZATION_ID`: OpenAI组织ID（可选，多账户管理时使用）
- `OPENAI_MODEL`: 模型名称（默认 `gpt-4o`，根据服务商支持情况选择）
  - OpenAI支持的模型：`gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4-vision-preview`, `gpt-4`, `gpt-3.5-turbo`
  - Vision模型推荐：`gpt-4o`（推荐）、`gpt-4-vision-preview`、`gpt-4-turbo`
  - 使用兼容服务商时，请参考服务商文档选择支持的模型

**OpenAI API参数配置**
- `OPENAI_TEMPERATURE`: 温度参数（0-2，默认 `0.7`），控制输出随机性
- `OPENAI_MAX_TOKENS`: 最大token数（默认 `1000`），控制响应长度
- `OPENAI_TOP_P`: Top-p采样参数（0-1，默认 `1.0`），控制多样性
- `OPENAI_FREQUENCY_PENALTY`: 频率惩罚（-2.0到2.0，默认 `0.0`），降低重复内容
- `OPENAI_PRESENCE_PENALTY`: 存在惩罚（-2.0到2.0，默认 `0.0`），鼓励新话题

**OpenAI Vision API配置**
- `OPENAI_VISION_DETAIL`: 图片分析详细度（`low` 或 `high`，默认 `high`）
  - `low`: 快速但细节较少（约85 tokens）
  - `high`: 详细但消耗更多tokens（约170 tokens）
- `OPENAI_VISION_LOW_DETAIL_MAX_TOKENS`: 低详细度时最大token数（默认 `85`）
- `OPENAI_VISION_HIGH_DETAIL_MAX_TOKENS`: 高详细度时最大token数（默认 `170`）

**OpenAI请求配置**
- `OPENAI_TIMEOUT`: 请求超时时间（毫秒，默认 `60000`，即60秒）
- `OPENAI_REQUEST_DELAY`: 请求之间的延迟（毫秒，默认 `500`），避免速率限制
- `OPENAI_MAX_RETRIES`: 最大重试次数（默认 `3`），自动重试失败的请求
- `OPENAI_RETRY_DELAY`: 重试延迟（毫秒，默认 `1000`），指数退避策略
- `OPENAI_CONCURRENCY`: 并发请求数（默认 `1`），注意API速率限制
- `OPENAI_PROXY`: 代理服务器地址（可选，格式：`http://proxy.example.com:8080`）

**备用AI服务配置**
- `USE_LOCAL_AI`: 是否使用本地AI服务（默认 `false`）
- `LOCAL_AI_SERVICE`: 本地AI服务地址（例如：`http://localhost:11434/v1/chat/completions`）
- `LOCAL_AI_TIMEOUT`: 本地AI服务超时时间（毫秒，默认 `60000`）
- `USE_CLAUDE`: 是否使用Claude API（默认 `false`）
- `CLAUDE_API_KEY`: Claude API密钥（可选）
- `CLAUDE_API_BASE`: Claude API基础URL（默认 `https://api.anthropic.com/v1`）
- `CLAUDE_MODEL`: Claude模型名称（默认 `claude-3-opus-20240229`）

**调试和日志配置**
- `AI_DEBUG`: 是否启用调试日志（默认 `false`），输出详细调试信息
- `AI_LOG_REQUESTS`: 是否记录请求日志（默认 `false`），记录所有API请求

**Web UI配置**
- `ENABLE_WEBUI`: 是否启用Web UI服务器（默认 `true`）
- `WEBUI_PORT`: Web UI服务器端口（默认 `3001`）
- `WEBUI_SECRET`: Web UI访问密钥（用于生成访问token，**请修改默认值**）
- `WEBUI_BASE_URL`: Web UI基础URL（用于邮件中的链接，默认 `http://localhost:3001`）

**Web UI使用说明**：
- Web UI是一个用于选择视频偏好的Web界面，**通过每日总结邮件中的链接访问**
- 点击邮件中的"告诉我你喜欢哪些视频"链接（链接包含安全的访问令牌和日期参数）
- 在打开的页面中选择你喜欢的（👍）或不喜欢的（👎）视频，然后提交反馈
- 你的反馈会帮助AI系统学习你的偏好，从而为你推荐更符合你兴趣的内容
- 如果直接访问 `http://localhost:3001/`，会看到说明页面
- **注意**：不能直接访问 `/preference` 页面，因为它需要有效的访问令牌（通过邮件链接提供）

**邮件服务配置**
- `EMAIL_FROM`: 发件人邮箱地址
- `EMAIL_TO`: 收件人邮箱地址
- `EMAIL_HOST`: 邮件服务器地址（默认 `smtp.gmail.com`）
- `EMAIL_PORT`: 邮件服务器端口（默认 `587`）
- `EMAIL_USER`: 邮件服务器用户名
- `EMAIL_PASSWORD`: 邮件服务器密码或应用专用密码

**偏好学习配置**
- `PREFERENCE_LIKE_WEIGHT`: 喜欢视频的权重分数（默认 `1.0`）
- `PREFERENCE_DISLIKE_WEIGHT`: 不喜欢视频的权重分数（默认 `-1.0`）

### 用户配置 (config.json)
- `users`: 用户列表
  - `sec_user_id`: 用户的sec_user_id
  - `username`: 用户名称
  - `monitor_type`: 监控类型 (posts或likes)
  - `max_cursor`: 分页游标，应用会自动更新
- `settings`: 全局设置
  - `page_size`: 每页获取的作品数量
  - `sort_type`: 排序类型 (0: 最新, 1: 最热)

## AI功能使用说明

### 启用AI功能

1. **安装ffmpeg**（视频帧提取需要）
   ```bash
   # Ubuntu/Debian
   sudo apt install ffmpeg
   
   # macOS
   brew install ffmpeg
   
   # Windows
   # 从 https://ffmpeg.org/download.html 下载安装
   ```

2. **配置环境变量**

   **最小配置（必需）**：
   ```bash
   # 启用AI功能
   ENABLE_AI=true
   
   # OpenAI API配置（必需）
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
   
   # 邮件服务配置（用于接收每日总结）
   EMAIL_TO=your-email@example.com
   EMAIL_USER=your-email@example.com
   EMAIL_PASSWORD=your-app-password
   
   # 每日总结时间
   AI_DAILY_SCHEDULE_TIME=18:00
   ```

   **完整配置示例**：
   ```bash
   # ========== 基础配置 ==========
   ENABLE_AI=true
   FRAMES_PER_VIDEO=5
   AI_DAILY_SCHEDULE_TIME=18:00
   
   # ========== OpenAI API配置 ==========
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
   OPENAI_API_BASE=https://api.openai.com/v1  # 可切换到兼容服务商
   OPENAI_ORGANIZATION_ID=org-xxxxxxxxxx  # 可选
   OPENAI_MODEL=gpt-4o
   
   # ========== 使用兼容服务商示例 ==========
   # 火山引擎示例：
   # OPENAI_API_BASE=https://ark.cn-beijing.volces.com/api/v3
   # OPENAI_API_KEY=your-volces-api-key
   
   # 阿里云通义千问示例：
   # OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
   # OPENAI_API_KEY=sk-your-dashscope-key
   
   # ========== API参数配置 ==========
   OPENAI_TEMPERATURE=0.7
   OPENAI_MAX_TOKENS=1000
   OPENAI_TOP_P=1.0
   OPENAI_FREQUENCY_PENALTY=0.0
   OPENAI_PRESENCE_PENALTY=0.0
   
   # ========== Vision API配置 ==========
   OPENAI_VISION_DETAIL=high  # low 或 high
   
   # ========== 请求控制配置 ==========
   OPENAI_TIMEOUT=60000  # 60秒
   OPENAI_REQUEST_DELAY=500  # 500毫秒
   OPENAI_MAX_RETRIES=3
   OPENAI_RETRY_DELAY=1000  # 1秒
   OPENAI_CONCURRENCY=1  # 注意速率限制
   OPENAI_PROXY=http://proxy.example.com:8080  # 可选
   
   # ========== 调试配置 ==========
   AI_DEBUG=false
   AI_LOG_REQUESTS=false
   
   # ========== Web UI配置 ==========
   ENABLE_WEBUI=true
   WEBUI_PORT=3001
   WEBUI_SECRET=change-this-secret-key
   WEBUI_BASE_URL=http://localhost:3001
   
   # ========== 邮件服务配置 ==========
   EMAIL_FROM=your-email@example.com
   EMAIL_TO=your-email@example.com
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@example.com
   EMAIL_PASSWORD=your-app-password
   
   # ========== 偏好学习配置 ==========
   PREFERENCE_LIKE_WEIGHT=1.0
   PREFERENCE_DISLIKE_WEIGHT=-1.0
   ```

   **配置说明**：
   - **兼容服务商**：通过修改 `OPENAI_API_BASE` 可以切换到任何OpenAI API兼容的服务商（如火山引擎、阿里云通义等）
   - **模型选择**：推荐使用 `gpt-4o`（速度快、质量高），或 `gpt-4o-mini`（成本更低）
     - 使用兼容服务商时，请参考服务商文档选择支持的模型
   - **Vision详细度**：`high` 提供更多细节但消耗更多tokens，`low` 降低成本
   - **并发控制**：`OPENAI_CONCURRENCY` 建议设置为1，避免速率限制
   - **代理配置**：如果需要通过代理访问API，配置 `OPENAI_PROXY`

3. **启动应用**
   ```bash
   npm start
   ```

### AI功能工作流程

1. **视频分析**（视频下载后自动进行）
   - 使用ffmpeg从每个视频中提取多个帧
   - 使用OpenAI Vision API分析视频帧特征
   - 保存特征信息到数据库

2. **每日总结**（定时任务）
   - 每天指定时间自动生成今日视频下载总结
   - 通过邮件发送总结报告
   - 邮件中包含Web UI链接，让你选择喜欢的视频

3. **偏好学习**
   - 通过Web UI选择你喜欢的视频
   - 系统学习你的偏好特征
   - 根据偏好对视频进行智能排序

4. **智能推荐**
   - 根据历史偏好计算视频推荐分数
   - 在每日总结中优先展示你更可能喜欢的视频

### Web UI使用

1. 在每日总结邮件中点击Web UI链接
2. 在网页中选择你喜欢的视频（👍）或不喜欢的视频（👎）
3. 提交反馈后，系统会学习你的偏好

## 注意事项

- 使用前确保您已在 TikHub 注册并获取 API 密钥
- API调用可能会产生费用，请根据您的使用情况注意
- 请遵守相关法律法规，合法使用本工具
- **AI功能需要**：
  - 安装ffmpeg用于视频帧提取
  - 配置OpenAI API密钥（会产生API调用费用）
  - 配置邮件服务用于接收每日总结