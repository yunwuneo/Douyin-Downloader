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
    if (existingFeatures && existingFeatures.ai_features) {
      console.log(`    ⚠ 作品 ${aweme_id} 已经分析过，跳过（可能被其他进程分析）`);
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
    const unanalyzedItems = await db.getUnanalyzedVideosForAnalysis(ANALYZE_BATCH_SIZE);
    
    if (unanalyzedItems.length === 0) {
      console.log('\n  ✓ 所有已下载的作品都已分析完成，等待下次检查...');
      analysisState.status = 'idle';
      return;
    }
    
    console.log(`\n🔍 本次处理:`);
    console.log(`  找到 ${unanalyzedItems.length} 个未分析的作品（批次大小: ${ANALYZE_BATCH_SIZE}）`);
    console.log(`  剩余未分析: ${analysisStats.totalUnanalyzed} 个`);
    
    // 统计信息 (仅用于本次日志输出，全局统计在 analysisState 中累积)
    const currentBatchStats = {
      total: unanalyzedItems.length,
      success: 0,
      failed: 0,
      skipped: 0,
      video: 0,
      image: 0,
      noMedia: 0
    };
    
    // 并发处理
    console.log(`  并发数: ${ANALYZE_CONCURRENCY}`);
    
    let currentIndex = 0;
    const totalItems = unanalyzedItems.length;
    
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
        const item = unanalyzedItems[index];
        
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
            }
            
            // 实时更新总数
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
    console.log(`  视频: ${currentBatchStats.video}, 图片: ${currentBatchStats.image}`);
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

