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
 *   ENABLE_AI: 必须设置为 'true' 才能启用AI分析
 */

const path = require('path');
require('dotenv').config();

// 导入必要的模块
const db = require('../src/db');
const summaryService = require('../src/summaryService');
const videoProcessor = require('../src/videoProcessor');
const aiAnalyzer = require('../src/aiAnalyzer');

// 配置
const ANALYZE_INTERVAL = parseInt(process.env.ANALYZE_INTERVAL) || 3600000; // 默认1小时
const ANALYZE_BATCH_SIZE = parseInt(process.env.ANALYZE_BATCH_SIZE) || 5; // 每次处理5个作品
const ENABLE_AI = process.env.ENABLE_AI === 'true';

/**
 * 分析单个作品
 */
async function analyzeItem(item) {
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
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${new Date().toLocaleString('zh-CN')}] 开始检查未分析的作品...`);
    
    // 获取统计信息
    const analysisStats = await db.getAnalysisStats();
    console.log(`\n📊 数据库统计信息:`);
    console.log(`  已下载作品总数: ${analysisStats.totalDownloaded}`);
    console.log(`  已分析作品数: ${analysisStats.totalAnalyzed}`);
    console.log(`  未分析作品数: ${analysisStats.totalUnanalyzed}`);
    console.log(`  分析进度: ${analysisStats.totalDownloaded > 0 
      ? ((analysisStats.totalAnalyzed / analysisStats.totalDownloaded) * 100).toFixed(2) 
      : 0}%`);
    
    // 获取未分析的作品列表（使用专门用于分析的方法）
    const unanalyzedItems = await db.getUnanalyzedVideosForAnalysis(ANALYZE_BATCH_SIZE);
    
    if (unanalyzedItems.length === 0) {
      console.log('\n  ✓ 所有已下载的作品都已分析完成，等待下次检查...');
      return;
    }
    
    console.log(`\n🔍 本次处理:`);
    console.log(`  找到 ${unanalyzedItems.length} 个未分析的作品（批次大小: ${ANALYZE_BATCH_SIZE}）`);
    console.log(`  剩余未分析: ${analysisStats.totalUnanalyzed} 个`);
    
    // 统计信息
    const stats = {
      total: unanalyzedItems.length,
      success: 0,
      failed: 0,
      skipped: 0,
      video: 0,
      image: 0,
      noMedia: 0
    };
    
    // 逐个处理作品
    for (let i = 0; i < unanalyzedItems.length; i++) {
      const item = unanalyzedItems[i];
      console.log(`\n  [${i + 1}/${unanalyzedItems.length}] 处理作品: ${item.aweme_id}`);
      
      const result = await analyzeItem(item);
      
      if (result.success) {
        stats.success++;
        if (result.skipped) {
          stats.skipped++;
        }
        if (result.mediaType === 'video') {
          stats.video++;
        } else if (result.mediaType === 'image') {
          stats.image++;
        }
      } else {
        stats.failed++;
        if (result.mediaType === null) {
          stats.noMedia++;
        }
      }
      
      // 避免处理过快，给AI API一些喘息时间
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 获取更新后的统计信息
    const updatedStats = await db.getAnalysisStats();
    
    // 输出统计信息
    console.log(`\n📈 处理完成统计:`);
    console.log(`  本次处理总数: ${stats.total}`);
    console.log(`  成功: ${stats.success} (跳过: ${stats.skipped})`);
    console.log(`  失败: ${stats.failed}`);
    console.log(`  视频: ${stats.video}, 图片: ${stats.image}`);
    if (stats.noMedia > 0) {
      console.log(`  未找到媒体文件: ${stats.noMedia}`);
    }
    console.log(`\n📊 更新后的统计:`);
    console.log(`  已下载: ${updatedStats.totalDownloaded}`);
    console.log(`  已分析: ${updatedStats.totalAnalyzed} (+${updatedStats.totalAnalyzed - analysisStats.totalAnalyzed})`);
    console.log(`  未分析: ${updatedStats.totalUnanalyzed} (-${analysisStats.totalUnanalyzed - updatedStats.totalUnanalyzed})`);
    console.log(`  分析进度: ${updatedStats.totalDownloaded > 0 
      ? ((updatedStats.totalAnalyzed / updatedStats.totalDownloaded) * 100).toFixed(2) 
      : 0}%`);
    console.log(`${'='.repeat(60)}\n`);
    
  } catch (error) {
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

