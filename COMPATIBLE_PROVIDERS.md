# OpenAI API 兼容服务商配置指南

本项目支持使用任何与OpenAI API兼容的服务商。只需修改 `OPENAI_API_BASE` 环境变量即可切换到不同的服务商。

## 配置方法

所有兼容服务商使用相同的配置方式，只需修改以下环境变量：

```bash
# 使用兼容服务商
OPENAI_API_KEY=your-service-api-key
OPENAI_API_BASE=https://your-service-endpoint.com/v1
OPENAI_MODEL=your-model-name  # 根据服务商支持的模型调整
```

## 支持的兼容服务商示例

### 1. 火山引擎（VeByte Ark）

**配置示例**：
```bash
ENABLE_AI=true
OPENAI_API_KEY=your-volces-api-key
OPENAI_API_BASE=https://ark.cn-beijing.volces.com/api/v3
OPENAI_MODEL=gpt-4o  # 根据火山引擎支持的模型调整
```

**注意事项**：
- 确保火山引擎支持Vision API（图像分析功能）
- 模型名称可能需要根据火山引擎的命名规范调整
- 参考火山引擎官方文档获取最新的API地址

**官方文档**：
- [火山引擎 Ark 服务文档](https://www.volcengine.com/docs/82379)

### 2. 阿里云通义千问（DashScope）

**配置示例**：
```bash
ENABLE_AI=true
OPENAI_API_KEY=sk-your-dashscope-key
OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-vl-max  # 或 qwen-vl-plus 等支持视觉的模型
```

**注意事项**：
- 使用通义千问的兼容模式
- 需要选择支持视觉分析（Vision）的模型，如 `qwen-vl-max` 或 `qwen-vl-plus`
- 确保API密钥有相应的权限

**官方文档**：
- [阿里云DashScope文档](https://help.aliyun.com/zh/model-studio/)
- [通义千问VL模型](https://help.aliyun.com/zh/model-studio/model-service/multimodal-generation)

### 3. Azure OpenAI

**配置示例**：
```bash
ENABLE_AI=true
OPENAI_API_KEY=your-azure-openai-key
OPENAI_API_BASE=https://your-resource.openai.azure.com/
OPENAI_MODEL=gpt-4-vision-preview  # 或 gpt-4o 等支持视觉的模型
```

**注意事项**：
- 需要将部署名称作为模型名称的一部分（如 `deployment-name`）
- 确保Azure OpenAI服务已启用Vision功能
- API版本可能需要调整

**官方文档**：
- [Azure OpenAI 文档](https://learn.microsoft.com/zh-cn/azure/ai-services/openai/)

### 4. 其他OpenAI兼容服务商

如果你使用的服务商也兼容OpenAI API，可以按以下方式配置：

```bash
ENABLE_AI=true
OPENAI_API_KEY=your-service-api-key
OPENAI_API_BASE=https://your-service-endpoint.com/v1  # 根据服务商文档设置
OPENAI_MODEL=your-model-name  # 根据服务商支持的模型调整
```

**常见兼容服务商**：
- DeepSeek
- Zhipu AI (智谱AI)
- Moonshot AI
- 其他提供OpenAI API兼容接口的服务商

## 配置检查清单

在使用兼容服务商前，请确认：

- [ ] 服务商支持OpenAI API兼容接口
- [ ] 服务商支持Vision API（图像分析功能）
- [ ] 已获取正确的API密钥
- [ ] API基础URL正确（通常包含 `/v1` 或 `/api/v3` 等路径）
- [ ] 模型名称正确（参考服务商文档）
- [ ] API密钥有相应的权限和配额

## 测试配置

配置完成后，可以通过以下方式测试：

1. **启用调试模式**：
   ```bash
   AI_DEBUG=true
   AI_LOG_REQUESTS=true
   ```

2. **启动应用**，查看日志：
   - 检查API URL是否正确
   - 检查请求是否成功
   - 查看错误信息（如果有）

3. **测试图像分析**：
   - 下载一个视频
   - 查看是否能正常提取帧并分析

## 常见问题

### 1. 401 Unauthorized

**原因**：API密钥错误或无效

**解决方法**：
- 检查 `OPENAI_API_KEY` 是否正确
- 确认API密钥有相应权限
- 检查API密钥是否过期

### 2. 404 Not Found

**原因**：API地址或模型名称错误

**解决方法**：
- 检查 `OPENAI_API_BASE` 是否正确
- 确认API路径包含正确的版本（如 `/v1`）
- 检查模型名称是否在服务商支持的列表中

### 3. 模型不支持Vision功能

**原因**：选择的模型不支持图像分析

**解决方法**：
- 切换到支持Vision的模型
- 检查服务商文档中的模型功能说明

### 4. 请求格式不兼容

**原因**：服务商的API格式与OpenAI不完全兼容

**解决方法**：
- 检查服务商文档中的API格式要求
- 可能需要修改请求格式（代码层面）

## 性能建议

不同服务商的性能可能有所差异：

1. **延迟**：不同服务商的响应时间可能不同，可以调整 `OPENAI_TIMEOUT`
2. **速率限制**：注意各服务商的速率限制，调整 `OPENAI_REQUEST_DELAY` 和 `OPENAI_CONCURRENCY`
3. **成本**：不同服务商的定价可能不同，根据需要选择

## 切换服务商

如果需要在不同服务商之间切换，只需修改环境变量并重启应用：

```bash
# 切换到火山引擎
OPENAI_API_BASE=https://ark.cn-beijing.volces.com/api/v3
OPENAI_API_KEY=your-volces-key
OPENAI_MODEL=gpt-4o

# 或切换回OpenAI官方
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o
```

无需修改代码，只需更新配置即可。

## 更多帮助

如果遇到问题：

1. 查看服务商的官方文档
2. 启用 `AI_DEBUG=true` 查看详细日志
3. 检查服务商的API状态和公告
4. 参考本项目的 `AI_CONFIG.md` 获取更多配置选项



