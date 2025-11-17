# 抖音作品监控下载器

这是一个Node.js项目，可以定期监控指定抖音用户发布的作品或点赞的作品，并自动下载包括文字、照片和视频内容。

## 功能特性

- 监控多个抖音用户的发布作品或点赞作品
- 自动下载视频、照片和文字描述
- 支持定时任务，可配置监控间隔
- 使用TikHub API获取抖音数据

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

### 用户配置 (config.json)
- `users`: 用户列表
  - `sec_user_id`: 用户的sec_user_id
  - `username`: 用户名称
  - `monitor_type`: 监控类型 (posts或likes)
  - `max_cursor`: 分页游标，应用会自动更新
- `settings`: 全局设置
  - `page_size`: 每页获取的作品数量
  - `sort_type`: 排序类型 (0: 最新, 1: 最热)

## 注意事项

- 使用前确保您已在 TikHub 注册并获取 API 密钥
- API调用可能会产生费用，请根据您的使用情况注意
- 请遵守相关法律法规，合法使用本工具