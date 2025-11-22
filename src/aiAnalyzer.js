const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
require('dotenv').config();

/**
 * AI分析服务
 * 负责分析视频帧、提取特征等
 */
class AIAnalyzer {
  constructor() {
    // ========== OpenAI API配置 ==========
    this.apiKey = process.env.OPENAI_API_KEY;
    // API基础URL - 支持自定义，可以切换到其他OpenAI API兼容的服务商
    // 例如：火山引擎、阿里云通义、Azure OpenAI等
    // 默认：https://api.openai.com/v1
    // 火山引擎示例：https://ark.cn-beijing.volces.com/api/v3
    // 阿里云通义示例：https://dashscope.aliyuncs.com/compatible-mode/v1
    // Azure OpenAI示例：https://your-resource.openai.azure.com/
    this.apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    this.organizationId = process.env.OPENAI_ORGANIZATION_ID || null; // 组织ID（可选）
    
    // 模型配置
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
    this.modelOptions = {
      // 支持的模型列表（可根据需要选择）
      // 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4', 'gpt-3.5-turbo'
      supported: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4', 'gpt-3.5-turbo']
    };
    
    // API请求参数配置
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7; // 温度参数 (0-2)
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 1000; // 最大token数
    this.topP = parseFloat(process.env.OPENAI_TOP_P) || 1.0; // Top-p采样 (0-1)
    this.frequencyPenalty = parseFloat(process.env.OPENAI_FREQUENCY_PENALTY) || 0.0; // 频率惩罚 (-2.0 to 2.0)
    this.presencePenalty = parseFloat(process.env.OPENAI_PRESENCE_PENALTY) || 0.0; // 存在惩罚 (-2.0 to 2.0)
    
    // Vision API特定配置
    this.visionDetail = process.env.OPENAI_VISION_DETAIL || 'high'; // 'low' 或 'high'
    this.visionLowDetailMaxTokens = parseInt(process.env.OPENAI_VISION_LOW_DETAIL_MAX_TOKENS) || 85;
    this.visionHighDetailMaxTokens = parseInt(process.env.OPENAI_VISION_HIGH_DETAIL_MAX_TOKENS) || 170;
    
    // 请求配置
    this.timeout = parseInt(process.env.OPENAI_TIMEOUT) || 60000; // 请求超时时间（毫秒），默认60秒
    this.requestDelay = parseInt(process.env.OPENAI_REQUEST_DELAY) || 500; // 请求之间的延迟（毫秒）
    this.maxRetries = parseInt(process.env.OPENAI_MAX_RETRIES) || 3; // 最大重试次数
    this.retryDelay = parseInt(process.env.OPENAI_RETRY_DELAY) || 1000; // 重试延迟（毫秒）
    this.concurrency = parseInt(process.env.OPENAI_CONCURRENCY) || 1; // 并发请求数（注意API限制）
    
    // 代理配置（如果通过代理访问）
    this.proxy = process.env.OPENAI_PROXY || null;
    
    // 使用OpenAI标志
    this.useOpenAI = !!this.apiKey;
    
    // ========== 备用AI服务配置 ==========
    // 本地AI服务或其他AI服务提供商
    this.useLocalModel = process.env.USE_LOCAL_AI === 'true';
    this.localAIService = process.env.LOCAL_AI_SERVICE || '';
    this.localAITimeout = parseInt(process.env.LOCAL_AI_TIMEOUT) || 60000;
    
    // Claude API配置（备用）
    this.claudeApiKey = process.env.CLAUDE_API_KEY || null;
    this.claudeApiBase = process.env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1';
    this.claudeModel = process.env.CLAUDE_MODEL || 'claude-3-opus-20240229';
    this.useClaude = !!this.claudeApiKey && process.env.USE_CLAUDE === 'true';
    
    // ========== 日志和调试配置 ==========
    this.debug = process.env.AI_DEBUG === 'true'; // 是否启用调试日志
    this.logRequests = process.env.AI_LOG_REQUESTS === 'true'; // 是否记录请求日志
    
    // 初始化axios实例（支持代理和自定义配置）
    this.initAxiosInstance();
  }

  /**
   * 初始化axios实例
   */
  initAxiosInstance() {
    const axiosConfig = {
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // 添加代理配置
    if (this.proxy) {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      axiosConfig.httpsAgent = new HttpsProxyAgent(this.proxy);
      axiosConfig.httpAgent = new HttpsProxyAgent(this.proxy);
    }

    // 创建axios实例
    this.axiosInstance = axios.create(axiosConfig);

    // 请求拦截器（用于日志）
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.logRequests) {
          console.log(`[AI Request] ${config.method?.toUpperCase()} ${config.url}`);
        }
        return config;
      },
      (error) => {
        console.error('[AI Request Error]', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器（用于日志和错误处理）
    this.axiosInstance.interceptors.response.use(
      (response) => {
        if (this.logRequests) {
          console.log(`[AI Response] Status: ${response.status}`);
        }
        return response;
      },
      async (error) => {
        if (error.response) {
          console.error(`[AI Response Error] Status: ${error.response.status}`, error.response.data);
          
          // 如果是429（速率限制），等待后重试
          if (error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] || 60;
            console.log(`[AI] Rate limited, waiting ${retryAfter} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * 将图片转换为base64
   */
  async imageToBase64(imagePath) {
    try {
      const imageBuffer = await fs.promises.readFile(imagePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      console.error(`读取图片失败 (${imagePath}):`, error.message);
      return null;
    }
  }

  /**
   * 使用OpenAI Vision API分析图片（带重试机制）
   */
  async analyzeImageWithOpenAI(imagePath, retryCount = 0) {
    try {
      if (!this.apiKey) {
        throw new Error('未配置OpenAI API Key');
      }

      const base64Image = await this.imageToBase64(imagePath);
      if (!base64Image) {
        return null;
      }

      // 获取图片扩展名
      const ext = path.extname(imagePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      // 构建请求头
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      // 如果配置了组织ID，添加到请求头
      if (this.organizationId) {
        headers['OpenAI-Organization'] = this.organizationId;
      }

      // 构建请求参数
      const requestPayload = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `请详细分析这张图片的内容特征。请用中文描述以下方面：
1. 场景类型（如：室内、户外、城市、自然等）
2. 人物特征（如：人数、性别、年龄、服装风格等）
3. 颜色特征（如：主色调、颜色风格等）
4. 风格特征（如：可爱、性感、搞怪、温馨等）
5. 其他显著特征

请以JSON格式返回，格式如下：
{
  "scene_type": "场景类型",
  "people": "人物特征",
  "colors": "颜色特征",
  "style": "风格特征",
  "description": "详细描述",
  "tags": ["标签1", "标签2", ...]
}`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: this.visionDetail // 'low' 或 'high'
                }
              }
            ]
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        top_p: this.topP,
        frequency_penalty: this.frequencyPenalty,
        presence_penalty: this.presencePenalty
      };

      if (this.debug) {
        console.log(`[AI Debug] 请求参数:`, {
          model: requestPayload.model,
          max_tokens: requestPayload.max_tokens,
          temperature: requestPayload.temperature,
          vision_detail: this.visionDetail
        });
      }

      // 发送请求（使用axios实例，支持代理和重试）
      // apiBase支持自定义，可以切换到其他OpenAI API兼容的服务商
      const apiUrl = `${this.apiBase}/chat/completions`;
      if (this.debug) {
        console.log(`[AI Debug] 请求URL: ${apiUrl}`);
        console.log(`[AI Debug] 使用模型: ${this.model}`);
      }
      
      const response = await this.axiosInstance.post(
        apiUrl,
        requestPayload,
        { headers }
      );

      const content = response.data.choices[0].message.content;
      
      if (this.debug) {
        console.log(`[AI Debug] 响应内容预览:`, content.substring(0, 200));
      }
      
      // 尝试解析JSON响应
      try {
        // 尝试提取JSON部分（如果响应包含其他文本）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed;
        }
        return JSON.parse(content);
      } catch (parseError) {
        if (this.debug) {
          console.warn(`[AI Debug] JSON解析失败，返回原始内容:`, parseError.message);
        }
        // 如果解析失败，返回文本描述
        return {
          description: content,
          raw_response: content
        };
      }
    } catch (error) {
      // 错误处理和重试逻辑
      const shouldRetry = retryCount < this.maxRetries && (
        error.response?.status === 429 || // 速率限制
        error.response?.status === 500 || // 服务器错误
        error.response?.status === 503 || // 服务不可用
        error.code === 'ECONNRESET' || // 连接重置
        error.code === 'ETIMEDOUT' // 超时
      );

      if (shouldRetry) {
        const delay = this.retryDelay * Math.pow(2, retryCount); // 指数退避
        console.log(`[AI] 请求失败，${delay}ms后重试 (${retryCount + 1}/${this.maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.analyzeImageWithOpenAI(imagePath, retryCount + 1);
      }

      console.error(`[AI] OpenAI分析图片失败 (${imagePath}):`, error.message);
      if (error.response) {
        console.error('[AI] API响应:', error.response.status, error.response.data);
      }
      if (this.debug) {
        console.error('[AI Debug] 完整错误:', error);
      }
      return null;
    }
  }

  /**
   * 使用本地AI服务分析图片（备用方案）
   */
  async analyzeImageWithLocal(imagePath) {
    try {
      if (!this.localAIService) {
        return null;
      }

      const base64Image = await this.imageToBase64(imagePath);
      if (!base64Image) {
        return null;
      }

      const response = await axios.post(
        this.localAIService,
        {
          image: base64Image,
          task: 'image_analysis'
        }
      );

      return response.data;
    } catch (error) {
      console.error(`本地AI服务分析图片失败:`, error.message);
      return null;
    }
  }

  /**
   * 分析单张图片
   */
  async analyzeFrame(framePath) {
    try {
      console.log(`开始分析图片: ${framePath}`);

      let result = null;

      if (this.useOpenAI) {
        result = await this.analyzeImageWithOpenAI(framePath);
      } else if (this.useLocalModel && this.localAIService) {
        result = await this.analyzeImageWithLocal(framePath);
      } else {
        console.warn('未配置AI服务，跳过图片分析');
        return null;
      }

      if (result) {
        console.log(`图片分析完成: ${framePath}`);
      }

      return result;
    } catch (error) {
      console.error(`分析图片时出错 (${framePath}):`, error.message);
      return null;
    }
  }

  /**
   * 分析多张图片并合并特征（支持并发控制）
   */
  async analyzeFrames(framePaths) {
    try {
      console.log(`开始分析 ${framePaths.length} 张图片...`);
      console.log(`配置: 模型=${this.model}, 并发数=${this.concurrency}, 延迟=${this.requestDelay}ms`);

      const frameAnalyses = [];

      // 如果并发数为1，顺序处理
      if (this.concurrency === 1) {
        for (const framePath of framePaths) {
          const analysis = await this.analyzeFrame(framePath);
          if (analysis) {
            frameAnalyses.push(analysis);
          }
          
          // 避免API调用过快
          if (this.requestDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.requestDelay));
          }
        }
      } else {
        // 并发处理（注意OpenAI API的速率限制）
        const chunks = [];
        for (let i = 0; i < framePaths.length; i += this.concurrency) {
          chunks.push(framePaths.slice(i, i + this.concurrency));
        }

        for (const chunk of chunks) {
          const promises = chunk.map(framePath => this.analyzeFrame(framePath));
          const results = await Promise.all(promises);
          
          results.forEach((analysis, index) => {
            if (analysis) {
              frameAnalyses.push(analysis);
            }
          });

          // 批次之间的延迟
          if (this.requestDelay > 0 && chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, this.requestDelay));
          }
        }
      }

      // 合并所有帧的特征
      const mergedFeatures = this.mergeFrameFeatures(frameAnalyses);

      console.log(`图片分析完成: 成功 ${frameAnalyses.length}/${framePaths.length} 张`);

      return {
        frames: frameAnalyses,
        merged: mergedFeatures,
        frameCount: frameAnalyses.length
      };
    } catch (error) {
      console.error(`分析图片帧时出错:`, error.message);
      if (this.debug) {
        console.error('[AI Debug] 完整错误:', error);
      }
      return null;
    }
  }

  /**
   * 获取配置信息（用于调试和日志）
   */
  getConfig() {
    return {
      provider: this.useOpenAI ? 'OpenAI' : (this.useClaude ? 'Claude' : (this.useLocalModel ? 'Local' : 'None')),
      model: this.model,
      apiBase: this.apiBase,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      timeout: this.timeout,
      requestDelay: this.requestDelay,
      maxRetries: this.maxRetries,
      concurrency: this.concurrency,
      visionDetail: this.visionDetail,
      proxy: this.proxy ? '已配置' : '未配置'
    };
  }

  /**
   * 验证配置
   */
  validateConfig() {
    const errors = [];

    if (!this.useOpenAI && !this.useClaude && !this.useLocalModel) {
      errors.push('未配置任何AI服务');
    }

    if (this.useOpenAI && !this.apiKey) {
      errors.push('启用了OpenAI但未配置API Key');
    }

    if (this.useClaude && !this.claudeApiKey) {
      errors.push('启用了Claude但未配置API Key');
    }

    if (this.useLocalModel && !this.localAIService) {
      errors.push('启用了本地AI但未配置服务地址');
    }

    if (this.temperature < 0 || this.temperature > 2) {
      errors.push('Temperature必须在0-2之间');
    }

    if (this.maxTokens < 1 || this.maxTokens > 4096) {
      errors.push('Max tokens必须在1-4096之间');
    }

    if (!this.modelOptions.supported.includes(this.model)) {
      console.warn(`[AI] 警告: 模型 ${this.model} 不在支持的模型列表中`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 合并多张图片的特征
   */
  mergeFrameFeatures(frameAnalyses) {
    if (!frameAnalyses || frameAnalyses.length === 0) {
      return {};
    }

    // 统计特征
    const sceneTypes = {};
    const colors = {};
    const styles = {};
    const tags = {};
    const descriptions = [];

    frameAnalyses.forEach(analysis => {
      // 统计场景类型
      if (analysis.scene_type) {
        sceneTypes[analysis.scene_type] = (sceneTypes[analysis.scene_type] || 0) + 1;
      }

      // 统计颜色
      if (analysis.colors) {
        const colorWords = analysis.colors.split(/[、,，]/);
        colorWords.forEach(color => {
          const c = color.trim();
          if (c) {
            colors[c] = (colors[c] || 0) + 1;
          }
        });
      }

      // 统计风格
      if (analysis.style) {
        const styleWords = analysis.style.split(/[、,，]/);
        styleWords.forEach(style => {
          const s = style.trim();
          if (s) {
            styles[s] = (styles[s] || 0) + 1;
          }
        });
      }

      // 统计标签
      if (analysis.tags && Array.isArray(analysis.tags)) {
        analysis.tags.forEach(tag => {
          tags[tag] = (tags[tag] || 0) + 1;
        });
      }

      // 收集描述
      if (analysis.description) {
        descriptions.push(analysis.description);
      }
    });

    // 获取最常见的特征
    const getMostCommon = (obj) => {
      const sorted = Object.entries(obj).sort((a, b) => b[1] - a[1]);
      return sorted.slice(0, 3).map(item => item[0]);
    };

    return {
      primary_scene_type: getMostCommon(sceneTypes)[0] || '未知',
      all_scene_types: getMostCommon(sceneTypes),
      primary_colors: getMostCommon(colors),
      primary_styles: getMostCommon(styles),
      top_tags: getMostCommon(tags).slice(0, 10),
      description_summary: descriptions.join('；'),
      frame_count: frameAnalyses.length
    };
  }
}

module.exports = new AIAnalyzer();

