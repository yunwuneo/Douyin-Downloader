#!/usr/bin/env node

/**
 * 定时遍历所有已下载的作品，并检查是否进行了AI分析
 * 如果没有，则进行AI分析
 * 
 * 使用方法:
 *   node scripts/analyze-downloaded-items.js
 * 
 * 环境变量:
 *   ANALYZE_INTERVAL: 检查间隔（毫秒），默认 3600000 (1小时)
 *   ANALYZE_BATCH_SIZE: 每次处理的作品数量，默认 5
 *   ANALYZE_CONCURRENCY: 并发处理数量，默认 3
 *   ENABLE_AI: 必须设置为 'true' 才能启用AI分析
 */

const path = require('path');
const express = require('express');
require('dotenv').config();

// 导入必要的模块
const db = require('../src/db');
const summaryService = require('../src/summaryService');
const videoProcessor = require('../src/videoProcessor');
const aiAnalyzer = require('../src/aiAnalyzer');

const vectorStore = require('../src/vectorStore');

// 配置
const ANALYZE_INTERVAL = parseInt(process.env.ANALYZE_INTERVAL) || 3600000; // 默认1小时
const ANALYZE_BATCH_SIZE = parseInt(process.env.ANALYZE_BATCH_SIZE) || 5; // 每次处理5个作品
const ANALYZE_CONCURRENCY = parseInt(process.env.ANALYZE_CONCURRENCY) || 3; // 默认并发数3
const ANALYZE_UI_PORT = parseInt(process.env.ANALYZE_UI_PORT) || 3002;
const ENABLE_AI = process.env.ENABLE_AI === 'true';

// 全局状态
const analysisState = {
  startTime: Date.now(),
  status: 'idle', // idle, running
  stats: {
    totalDownloaded: 0,
    totalAnalyzed: 0,
    totalUnanalyzed: 0,
    progress: 0,
    sessionProcessed: 0,
    sessionSuccess: 0,
    sessionFailed: 0,
    sessionSkipped: 0,
    sessionVideo: 0,
    sessionImage: 0
  },
  workers: [], // { id, status, item }
  logs: []
};

// 日志封装
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('zh-CN');
  // 简单的格式化，处理对象
  const formattedMessage = typeof message === 'object' ? JSON.stringify(message) : String(message);
  const logEntry = { time: timestamp, message: formattedMessage, type };
  
  // 保持日志队列长度
  analysisState.logs.push(logEntry);
  if (analysisState.logs.length > 100) {
    analysisState.logs.shift();
  }
  
  if (type === 'error') {
    originalConsoleError(message);
  } else {
    originalConsoleLog(message);
  }
}

// 覆盖 console 方法以捕获日志
console.log = (msg, ...args) => log(msg + (args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') : ''), 'info');
console.error = (msg, ...args) => log(msg + (args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') : ''), 'error');

/**
 * 启动 Web Server
 */
function startWebServer() {
  const app = express();
  
  // 静态文件
  app.use(express.static(path.join(__dirname, 'analyze-ui')));
  
  // API
  app.get('/api/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - analysisState.startTime) / 1000);
    res.json({
      status: analysisState.status,
      uptime,
      stats: analysisState.stats,
      workers: analysisState.workers,
      logs: analysisState.logs
    });
  });
  
  app.listen(ANALYZE_UI_PORT, () => {
    // 使用原始 console 防止递归或过多日志
    originalConsoleLog(`Web UI 控制台已启动: http://localhost:${ANALYZE_UI_PORT}`);
  });

  // 挂载下载目录为静态资源，用于预览
  const downloadDir = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
  app.use('/downloads', express.static(downloadDir));
}

/**
 * 更新 Worker 的预览信息
 */
function updateWorkerPreview(workerId, filePath, type) {
  try {
    if (!workerId || !filePath) return;
    
    const worker = analysisState.workers.find(w => w.id === workerId);
    if (worker) {
      // 确保路径是绝对路径
      const absDownloadDir = path.resolve(process.env.DOWNLOAD_DIR || './downloads');
      const absFilePath = path.resolve(filePath);
      
      // 检查文件是否在下载目录内
      if (absFilePath.startsWith(absDownloadDir)) {
        const relativePath = path.relative(absDownloadDir, absFilePath);
        // 统一转换为 URL 路径分隔符，并进行 URL 编码
        // 注意：我们需要分别对每一级目录/文件名进行编码，然后再用 / 连接
        const urlPath = relativePath.split(path.sep)
          .map(part => encodeURIComponent(part))
          .join('/');
          
        worker.preview = `/downloads/${urlPath}`;
        worker.mediaType = type;
        worker.item = worker.item || path.basename(filePath); // 确保有 item 标识
      }
    }
  } catch (e) {
    // 忽略路径转换错误
    console.error('更新预览图失败:', e.message);
  }
}

/**
 * 分析单个作品
 */
async function analyzeItem(item, workerId) {
  const { aweme_id, user_name } = item;
  
  try {
    // 检查是否已经分析过（双重检查，防止并发问题）
    const existingFeatures = await db.getVideoFeatures(aweme_id);
    let hasFeatures = false;
    
    if (existingFeatures && existingFeatures.ai_features) {
      hasFeatures = true;
      
      // 检查是否缺失向量
      const vector = await vectorStore.getVector(aweme_id);
      if (vector) {
        console.log(`    ⚠ 作品 ${aweme_id} 已经分析且有向量，跳过`);
        return { success: true, skipped: true, aweme_id };
      } else {
        console.log(`    ℹ 作品 ${aweme_id} 已分析但缺失向量，将进行补充`);
        // 尝试只补充向量
        const aiFeatures = existingFeatures.ai_features;
        const textToEmbed = `
          场景: ${aiFeatures.primary_scene_type || ''};
          人物: ${aiFeatures.people || ''};
          风格: ${aiFeatures.primary_styles ? aiFeatures.primary_styles.join(',') : ''};
          描述: ${aiFeatures.description_summary || ''};
          标签: ${aiFeatures.top_tags ? aiFeatures.top_tags.join(',') : ''}
        `.trim();

        const newVector = await aiAnalyzer.generateEmbedding(textToEmbed);
        if (newVector) {
          await vectorStore.saveVector(aweme_id, newVector, textToEmbed);
          console.log(`    ✅ 补充向量成功: ${aweme_id}`);
          return { success: true, skipped: false, aweme_id, mediaType: 'vector_only' };
        } else {
           console.warn(`    ⚠ 补充向量失败: ${aweme_id}`);
           // 如果补充向量失败，可能需要重新完整分析？或者暂时跳过
           // 这里选择跳过，避免死循环，也许是API问题
           return { success: false, skipped: false, aweme_id, error: '补充向量失败' };
        }
      }
    }
    
    // 如果没有分析过，或者需要重新完整分析（逻辑走到这里说明没有特征，或者上面补充向量逻辑已处理返回）
    if (hasFeatures) {
        // 理论上不应执行到这里，因为上面已经 return 了
        return { success: true, skipped: true, aweme_id };
    }

    // 先尝试查找视频文件
    console.log(`    🔍 查找视频文件...`);
    let videoPath = await summaryService.findVideoPath(user_name, aweme_id);
    
    if (videoPath) {
      // 更新预览图
      updateWorkerPreview(workerId, videoPath, 'video');

      // 处理视频分析
      console.log(`    ✓ 找到视频文件: ${videoPath}`);
      const analysis = await summaryService.processVideoAnalysis(user_name, aweme_id, videoPath);
      
      if (analysis) {
        console.log(`    ✅ 视频分析完成: ${aweme_id}`);
        return { success: true, skipped: false, aweme_id, mediaType: 'video' };
      } else {
        console.log(`    ❌ 视频分析失败: ${aweme_id}`);
        return { success: false, skipped: false, aweme_id, mediaType: 'video' };
      }
    } else {
      // 尝试查找图片文件
      console.log(`    🔍 未找到视频，查找图片文件...`);
      const imagePaths = await summaryService.findImagePaths(user_name, aweme_id);
      
      if (imagePaths && imagePaths.length > 0) {
        // 更新预览图 (使用第一张图片)
        updateWorkerPreview(workerId, imagePaths[0], 'image');

        console.log(`    ✓ 找到图片文件: ${imagePaths.length} 张`);
        const analysis = await summaryService.processImageAnalysis(user_name, aweme_id, imagePaths);
        
        if (analysis) {
          console.log(`    ✅ 图片分析完成: ${aweme_id}`);
          return { success: true, skipped: false, aweme_id, mediaType: 'image' };
        } else {
          console.log(`    ❌ 图片分析失败: ${aweme_id}`);
          return { success: false, skipped: false, aweme_id, mediaType: 'image' };
        }
      } else {
        console.log(`    ⚠ 未找到媒体文件: ${aweme_id} (用户: ${user_name})`);
        return { success: false, skipped: false, aweme_id, mediaType: null, reason: '未找到媒体文件' };
      }
    }
  } catch (error) {
    console.error(`    ❌ 分析作品时出错 (${aweme_id}):`, error.message);
    if (error.stack) {
      console.error(`    错误堆栈:`, error.stack);
    }
    return { success: false, skipped: false, aweme_id, error: error.message };
  }
}

/**
 * 处理一批未分析的作品
 */
async function processBatch() {
  try {
    analysisState.status = 'running';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${new Date().toLocaleString('zh-CN')}] 开始检查未分析的作品...`);
    
    // 获取统计信息
    const analysisStats = await db.getAnalysisStats();
    console.log(`\n📊 数据库统计信息:`);
    console.log(`  已下载作品总数: ${analysisStats.totalDownloaded}`);
    console.log(`  已分析作品数: ${analysisStats.totalAnalyzed}`);
    console.log(`  未分析作品数: ${analysisStats.totalUnanalyzed}`);
    
    const progress = analysisStats.totalDownloaded > 0 
      ? ((analysisStats.totalAnalyzed / analysisStats.totalDownloaded) * 100)
      : 0;
    console.log(`  分析进度: ${progress.toFixed(2)}%`);
    
    // 更新全局状态
    analysisState.stats.totalDownloaded = analysisStats.totalDownloaded;
    analysisState.stats.totalAnalyzed = analysisStats.totalAnalyzed;
    analysisState.stats.totalUnanalyzed = analysisStats.totalUnanalyzed;
    analysisState.stats.progress = progress;

    // 获取未分析的作品列表（使用专门用于分析的方法）
    // 还要获取“已分析但无向量”的作品列表
    // 目前 db 模块没有直接提供 "getAnalyzedButNoVector" 的方法
    // 我们可以先获取未分析的，处理完后再考虑缺失向量的
    // 或者修改逻辑：获取所有 completed 的，然后在 analyzeItem 内部判断
    
    // 为了不修改 db 接口太复杂，我们可以获取一批“已下载”的视频，然后在 analyzeItem 里做判断
    // 但这样效率低。
    // 更好的办法是让 db 提供一个获取所有已下载 aweme_id 的接口，然后在此脚本中与向量库比对
    // 考虑到性能，我们先处理完全未分析的，这是优先级最高的
    
    let itemsToProcess = await db.getUnanalyzedVideosForAnalysis(ANALYZE_BATCH_SIZE);
    
    // 如果未分析的少于批次大小，尝试获取“已分析但可能缺向量”的
    if (itemsToProcess.length < ANALYZE_BATCH_SIZE) {
        const limit = ANALYZE_BATCH_SIZE - itemsToProcess.length;
        // 获取最近分析的视频，检查是否有向量（这是一个近似策略）
        // 更精确的策略需要数据库层面支持 join vector table，但 vector table 在 sqlite，主库在 mysql/sqlite
        // 所以跨库查询很难。
        // 这里的策略是：随机获取一些已分析的视频，检查是否有向量
        const analyzedVideos = await db.getUnanalyzedVideos(limit * 2); // getUnanalyzedVideos 其实返回的是“已分析但未标记反馈”的？
        // 不，看 db 实现，getUnanalyzedVideos 返回的是 (vf.aweme_id IS NULL) OR (vf.aweme_id IS NOT NULL AND uf.aweme_id IS NULL)
        // 这不符合我们的需求。我们需要的是 "已分析" 的。
        
        // 我们需要一个新方法或者直接查询
        // 暂时使用一个简单策略：我们已知 video_features 表里的是已分析的
        // 我们可以获取最近分析的一批，然后在 analyzeItem 里检查
        // 由于无法直接知道哪些缺向量，我们只能随机抽取已分析的进行检查
        // 这在大规模数据下效率不高，但对于补全任务是可行的
        
        // 既然这是一个后台脚本，我们可以直接获取一批已下载的视频，忽略是否已分析的状态
        // 让 analyzeItem 去判断到底是全量分析还是补全向量
        
        // 重新设计：
        // 1. 获取未分析的 (Priority High)
        // 2. 如果不够，获取已分析的 (Priority Low) 用于检查向量
        
        // 现有的 getUnanalyzedVideosForAnalysis 是只返回 vf.aweme_id IS NULL 的
        
        // 我们补充获取一些随机的已下载视频
        const randomDownloaded = await db.getUnanalyzedVideos(limit); 
        // 注意：getUnanalyzedVideos 实际上是 "未被用户反馈" 的视频，包含了已分析和未分析
        // 我们可以利用这个，或者新增一个方法
        
        // 让我们简化逻辑：直接修改 getUnanalyzedVideosForAnalysis 的调用，
        // 改为获取“待处理”列表。
        // 由于无法精准从 DB 层知道谁缺向量（向量库是独立的），
        // 我们只能：
        // A. 遍历本地向量库，找出已有的，然后与 DB 对比（内存中）
        // B. 随机抽取已完成下载的视频，交给 analyzeItem 检查
        
        // 采用 B 方案，修改获取逻辑
    }
    
    // 如果上述逻辑太复杂，我们简化为：
    // 每次先获取未分析的。如果为空，则尝试获取“所有已下载”的随机样本进行检查
    
    if (itemsToProcess.length === 0) {
       // 获取随机的已下载视频，用于检查向量缺失
       // 这里我们需要一个能返回已下载视频的方法，不管是否已分析
       // db.getUnanalyzedVideos(limit) 返回的是 (未分析 OR (已分析 AND 未反馈))
       // 这基本覆盖了我们需要检查的范围（活跃数据）
       // 但对于很久以前已反馈的视频，可能也会缺向量。
       
       // 让我们临时用 getUnanalyzedVideos 来填充
       const candidates = await db.getUnanalyzedVideos(ANALYZE_BATCH_SIZE);
       
       // 过滤掉已经在 itemsToProcess 里的（虽然现在是空的）
       // 重点：analyzeItem 内部会检查向量是否存在，所以重复传进去没问题，会被 skipped
       itemsToProcess = candidates;
    }

    if (itemsToProcess.length === 0) {
      console.log('\n  ✓ 所有已下载的作品都已检查完毕，等待下次检查...');
      analysisState.status = 'idle';
      return;
    }
    
    console.log(`\n🔍 本次处理:`);
    console.log(`  找到 ${itemsToProcess.length} 个候选作品（包含未分析或需检查向量的）`);
    console.log(`  剩余未分析: ${analysisStats.totalUnanalyzed} 个`);
    
    // 统计信息 (仅用于本次日志输出，全局统计在 analysisState 中累积)
    const currentBatchStats = {
      total: itemsToProcess.length,
      success: 0,
      failed: 0,
      skipped: 0,
      video: 0,
      image: 0,
      vectorOnly: 0,
      noMedia: 0
    };
    
    // 并发处理
    console.log(`  并发数: ${ANALYZE_CONCURRENCY}`);
    
    let currentIndex = 0;
    const totalItems = itemsToProcess.length;
    
    // 初始化 workers 状态
    const actualConcurrency = Math.min(ANALYZE_CONCURRENCY, totalItems);
    analysisState.workers = Array(actualConcurrency).fill(null).map((_, i) => ({
      id: i + 1,
      status: 'idle',
      item: null
    }));
    
    // 定义工作函数
    const worker = async (workerId) => {
      while (currentIndex < totalItems) {
        // 获取下一个任务索引（原子操作）
        const index = currentIndex++;
        const item = itemsToProcess[index];
        
        // 更新 Worker 状态
        const workerState = analysisState.workers.find(w => w.id === workerId);
        if (workerState) {
            workerState.status = 'processing';
            workerState.item = item.aweme_id;
        }

        console.log(`\n  [Worker ${workerId}] [${index + 1}/${totalItems}] 处理作品: ${item.aweme_id}`);
        
        try {
          const result = await analyzeItem(item, workerId);
          
          analysisState.stats.sessionProcessed++;
          
          if (result.success) {
            currentBatchStats.success++;
            analysisState.stats.sessionSuccess++;
            
            if (result.skipped) {
              currentBatchStats.skipped++;
              analysisState.stats.sessionSkipped++;
            }
            if (result.mediaType === 'video') {
              currentBatchStats.video++;
              analysisState.stats.sessionVideo++;
            } else if (result.mediaType === 'image') {
              currentBatchStats.image++;
              analysisState.stats.sessionImage++;
            } else if (result.mediaType === 'vector_only') {
              currentBatchStats.vectorOnly++;
            }
            
            // 实时更新总数
            // 注意：如果是 vector_only，不应该增加 totalAnalyzed，因为它已经在之前的统计里了
            // 但为了简单起见，我们假设 database stats 是准确的
            analysisState.stats.totalAnalyzed++;
            analysisState.stats.totalUnanalyzed--;
            if (analysisState.stats.totalDownloaded > 0) {
              analysisState.stats.progress = (analysisState.stats.totalAnalyzed / analysisState.stats.totalDownloaded) * 100;
            }
            
          } else {
            currentBatchStats.failed++;
            analysisState.stats.sessionFailed++;
            if (result.mediaType === null) {
              currentBatchStats.noMedia++;
            }
          }
        } catch (error) {
          currentBatchStats.failed++;
          analysisState.stats.sessionFailed++;
          console.error(`  [Worker ${workerId}] 处理出错:`, error.message);
        }
        
        // 更新 Worker 状态为空闲
        if (workerState) {
            workerState.status = 'idle';
            workerState.item = null;
        }
        
        // 避免处理过快，给AI API一些喘息时间（并发时适当减少等待时间）
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };
    
    // 启动所有 workers
    const workers = [];
    
    for (let i = 0; i < actualConcurrency; i++) {
      workers.push(worker(i + 1));
    }
    
    // 等待所有任务完成
    await Promise.all(workers);
    
    // 获取更新后的统计信息
    const updatedStats = await db.getAnalysisStats();
    
    // 输出统计信息
    console.log(`\n📈 处理完成统计:`);
    console.log(`  本次处理总数: ${currentBatchStats.total}`);
    console.log(`  成功: ${currentBatchStats.success} (跳过: ${currentBatchStats.skipped})`);
    console.log(`  失败: ${currentBatchStats.failed}`);
    console.log(`  视频: ${currentBatchStats.video}, 图片: ${currentBatchStats.image}, 仅向量补全: ${currentBatchStats.vectorOnly}`);
    if (currentBatchStats.noMedia > 0) {
      console.log(`  未找到媒体文件: ${currentBatchStats.noMedia}`);
    }
    console.log(`\n📊 更新后的统计:`);
    console.log(`  已下载: ${updatedStats.totalDownloaded}`);
    console.log(`  已分析: ${updatedStats.totalAnalyzed} (+${updatedStats.totalAnalyzed - analysisStats.totalAnalyzed})`);
    console.log(`  未分析: ${updatedStats.totalUnanalyzed} (-${analysisStats.totalUnanalyzed - updatedStats.totalUnanalyzed})`);
    console.log(`  分析进度: ${updatedStats.totalDownloaded > 0 
      ? ((updatedStats.totalAnalyzed / updatedStats.totalDownloaded) * 100).toFixed(2) 
      : 0}%`);
    console.log(`${'='.repeat(60)}\n`);
    
    analysisState.status = 'idle';
    
  } catch (error) {
    analysisState.status = 'error';
    console.error(`处理批次时出错:`, error.message);
    console.error(error.stack);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('AI分析定时任务启动');
  console.log('='.repeat(60));
  
  // 检查AI功能是否启用
  if (!ENABLE_AI) {
    console.error('错误: ENABLE_AI 环境变量未设置为 "true"');
    console.error('请在 .env 文件中设置: ENABLE_AI=true');
    process.exit(1);
  }
  
  // 验证AI配置
  const aiConfig = aiAnalyzer.validateConfig();
  if (!aiConfig.valid) {
    console.error('错误: AI配置验证失败:');
    aiConfig.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  
  console.log(`配置信息:`);
  console.log(`  检查间隔: ${ANALYZE_INTERVAL / 1000 / 60} 分钟`);
  console.log(`  批次大小: ${ANALYZE_BATCH_SIZE} 个作品`);
  console.log(`  并发数量: ${ANALYZE_CONCURRENCY}`);
  console.log(`  AI配置:`, aiAnalyzer.getConfig());
  console.log('');
  
  // 初始化数据库
  try {
    await db.init();
    console.log('数据库初始化成功');
  } catch (error) {
    console.error('数据库初始化失败:', error.message);
    process.exit(1);
  }
  
  // 初始化视频处理器
  try {
    await videoProcessor.init();
    console.log('视频处理器初始化成功');
  } catch (error) {
    console.error('视频处理器初始化失败:', error.message);
    process.exit(1);
  }
  
  // 启动 Web UI
  startWebServer();
  
  // 立即执行一次
  await processBatch();
  
  // 设置定时任务
  const intervalId = setInterval(async () => {
    await processBatch();
  }, ANALYZE_INTERVAL);
  
  console.log(`定时任务已启动，每 ${ANALYZE_INTERVAL / 1000 / 60} 分钟检查一次`);
  console.log('按 Ctrl+C 停止任务\n');
  
  // 优雅退出处理
  process.on('SIGINT', async () => {
    console.log('\n\n收到退出信号，正在关闭...');
    clearInterval(intervalId);
    await db.close();
    console.log('已关闭数据库连接');
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n收到终止信号，正在关闭...');
    clearInterval(intervalId);
    await db.close();
    console.log('已关闭数据库连接');
    process.exit(0);
  });
}

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('程序运行出错:', error);
    process.exit(1);
  });
}

module.exports = { analyzeItem, processBatch };

