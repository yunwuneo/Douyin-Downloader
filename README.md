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
- `MAX_RETRY`: 下载失败重试次数

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