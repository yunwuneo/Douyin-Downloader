# AI功能说明文档

## 功能概述

本项目的AI功能实现了智能视频内容分析和用户偏好学习系统，主要包括以下功能：

### 1. 视频特征提取
- 使用ffmpeg从视频中提取多个关键帧
- 使用OpenAI Vision API分析视频帧内容
- 提取场景类型、人物特征、颜色、风格、标签等特征
- 将特征信息存储到数据库

### 2. 每日总结报告
- 每天定时（可配置时间）生成视频下载总结
- 自动处理当日下载的所有视频
- 根据用户偏好对视频进行智能排序
- 通过邮件发送精美的HTML格式总结报告

### 3. Web UI偏好选择
- 提供美观的Web界面让用户选择喜欢的视频
- 支持批量选择和多标签反馈
- 实时显示选择统计
- 安全的Token验证机制

### 4. 用户偏好学习
- 根据用户反馈学习视频特征偏好
- 使用加权平均算法更新偏好分数
- 支持正向（喜欢）和负向（不喜欢）反馈
- 特征匹配和推荐分数计算

## 技术架构

### 数据库扩展
新增了以下数据表：
- `video_features`: 存储视频特征信息
- `video_frames`: 存储视频帧信息
- `user_preferences`: 存储用户偏好特征
- `user_feedback`: 存储用户反馈记录
- `daily_summaries`: 存储每日总结报告

### 核心服务模块
1. **videoProcessor.js**: 视频帧提取服务（ffmpeg）
2. **aiAnalyzer.js**: AI分析服务（OpenAI Vision API）
3. **summaryService.js**: 每日总结生成服务
4. **emailService.js**: 邮件发送服务
5. **preferenceService.js**: 偏好学习服务
6. **webui-server.js**: Web UI服务器
7. **aiScheduler.js**: 定时任务调度器

## 使用流程

### 初始化
1. 安装依赖：`npm install`
2. 安装ffmpeg（系统级）
3. 配置环境变量（`.env`文件）
4. 启动应用：`npm start`

### 工作流程
1. **视频下载** → 视频文件保存到本地
2. **视频分析**（定时或手动） → 提取帧并分析特征
3. **每日总结**（定时任务） → 生成总结并发送邮件
4. **用户反馈**（Web UI） → 选择喜欢的视频
5. **偏好学习**（自动） → 更新偏好模型
6. **智能排序**（下次总结） → 根据偏好排序视频

## 环境变量配置

### 必需配置
```bash
ENABLE_AI=true
OPENAI_API_KEY=your-openai-api-key
EMAIL_TO=your-email@example.com
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-email-password
```

### 可选配置
```bash
# AI配置
OPENAI_MODEL=gpt-4o
FRAMES_PER_VIDEO=5
AI_DAILY_SCHEDULE_TIME=18:00

# Web UI配置
ENABLE_WEBUI=true
WEBUI_PORT=3001
WEBUI_SECRET=change-this-secret
WEBUI_BASE_URL=http://localhost:3001

## Web UI使用说明

Web UI是一个用于选择视频偏好的Web界面，**通过每日总结邮件中的链接访问**，而不是直接访问。

**正确使用方式**：
1. 等待系统发送每日总结邮件
2. 点击邮件中的"告诉我你喜欢哪些视频"链接（链接包含安全的访问令牌）
3. 在打开的页面中选择你喜欢的（👍）或不喜欢的（👎）视频
4. 点击"提交反馈"按钮

**Web UI首页功能**（新增）：
- 如果你直接访问 `http://localhost:3001/`，会看到一个展示未分析视频的页面
- 系统会随机提取几个已下载但尚未进行AI分析的视频
- 你可以点击"开始分析"按钮，系统将自动提取视频帧并使用AI分析视频特征
- 分析完成后，你可以选择喜欢（👍）或不喜欢的视频（👎）
- 你的选择会被保存，帮助系统学习你的偏好

**每日总结页面**：
- 通过邮件中的链接访问 `/preference` 页面
- 需要有效的访问令牌（token）和日期（date）参数
- 这些参数会通过邮件中的链接自动提供

# 邮件配置
EMAIL_FROM=your-email@example.com
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587

# 偏好权重
PREFERENCE_LIKE_WEIGHT=1.0
PREFERENCE_DISLIKE_WEIGHT=-1.0
```

## API调用说明

### OpenAI API
- 使用GPT-4o或GPT-4 Vision Preview模型
- 每次视频分析需要调用多次API（每个帧一次）
- API调用会产生费用，请注意使用量

### 邮件服务
- 支持SMTP协议
- Gmail需要使用应用专用密码
- 其他邮件服务需要相应配置

## 注意事项

1. **ffmpeg安装**：必须在系统PATH中可访问
2. **OpenAI API费用**：视频分析会产生API调用费用
3. **邮件服务**：确保邮件服务配置正确
4. **Web UI安全**：修改默认的`WEBUI_SECRET`值
5. **性能考虑**：大量视频分析可能需要较长时间

## 故障排除

### ffmpeg未找到
```bash
# 检查ffmpeg是否安装
ffmpeg -version

# 如果未安装，根据系统安装
# Ubuntu/Debian: sudo apt install ffmpeg
# macOS: brew install ffmpeg
```

### OpenAI API调用失败
- 检查API密钥是否正确
- 检查账户余额
- 查看API调用日志

### 邮件发送失败
- 检查邮件服务配置
- 确认应用专用密码（Gmail）
- 检查防火墙设置

### Web UI无法访问
- 检查端口是否被占用
- 确认`WEBUI_BASE_URL`配置正确
- 检查token是否有效

## 已实现的新功能

### 对已下载视频的AI分析

- **功能**：在Web UI首页可以随机提取几个已下载但尚未分析的视频，进行AI分析
- **使用方法**：
  1. 访问 `http://localhost:3001/` 首页
  2. 系统会随机展示一些未分析的视频
  3. 点击"开始分析"按钮，系统将自动提取视频帧并使用AI分析
  4. 分析完成后，选择喜欢或不喜欢的视频
  5. 点击"提交所有反馈"保存你的偏好
- **优势**：
  - 可以逐步分析历史下载的视频
  - 帮助系统更快地学习你的偏好
  - 不需要等待每日总结就能提供反馈

## 未来扩展

可以进一步扩展的功能：
- 支持更多AI服务提供商
- 视频内容自动分类
- 更复杂的推荐算法
- 用户偏好可视化
- 多用户支持
- 更丰富的邮件模板


