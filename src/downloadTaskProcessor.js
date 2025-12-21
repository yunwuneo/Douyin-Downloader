const downloader = require('./downloader');
const db = require('./db');
const summaryService = require('./summaryService');
const path = require('path');
require('dotenv').config();

/**
 * 下载任务处理器
 * 处理异步下载任务
 */
class DownloadTaskProcessor {
  constructor() {
    this.isProcessing = false;
    this.processingInterval = null;
    this.processingIntervalMs = 5000; // 每5秒检查一次待处理任务
  }

  /**
   * 处理单个下载任务
   * @param {string} jobId - 任务ID
   */
  async processJob(jobId) {
    try {
      const job = await db.getDownloadJob(jobId);
      if (!job) {
        console.error(`下载任务不存在: ${jobId}`);
        return;
      }

      // 如果任务已经完成或失败，跳过
      if (job.status === 'completed' || job.status === 'failed') {
        return;
      }

      // 更新状态为处理中
      await db.updateDownloadJobStatus(jobId, 'processing');

      console.log(`开始处理下载任务: ${jobId} (aweme_id: ${job.aweme_id})`);

      // 获取作品信息
      const videoInfo = await db.getDownloadStatus(job.aweme_id);
      if (!videoInfo) {
        throw new Error(`未找到作品信息: ${job.aweme_id}`);
      }

      // 构建作品数据对象（从video_info JSON中解析，如果存在）
      let item = null;
      if (videoInfo.video_info) {
        try {
          item = JSON.parse(videoInfo.video_info);
          // 确保aweme_id和id字段存在
          if (!item.aweme_id) item.aweme_id = videoInfo.aweme_id;
          if (!item.id) item.id = videoInfo.aweme_id;
        } catch (e) {
          console.warn(`解析video_info失败 (${job.aweme_id}):`, e.message);
        }
      }

      // 如果没有video_info或解析失败，尝试通过API获取
      if (!item || !item.video && !item.image_list && !item.images) {
        console.log(`尝试通过API获取作品信息: ${job.aweme_id}`);
        try {
          const apiClient = require('./apiClient');
          // 注意：这里需要根据实际的API来获取单个作品信息
          // 如果API不支持，则使用数据库中的基本信息
          console.warn(`无法通过API获取作品信息，使用数据库中的基本信息`);
        } catch (e) {
          console.warn(`通过API获取作品信息失败:`, e.message);
        }
      }

      // 如果仍然没有有效的item，使用数据库字段构建基本结构
      if (!item || (!item.video && !item.image_list && !item.images)) {
        console.warn(`作品信息不完整，可能无法下载: ${job.aweme_id}`);
        item = {
          aweme_id: videoInfo.aweme_id,
          id: videoInfo.aweme_id,
          desc: videoInfo.description || videoInfo.title,
          user: {
            unique_id: videoInfo.user_id,
            nickname: videoInfo.user_name
          }
        };
      }

      // 执行下载
      const success = await downloader.processItem(item, job.user_name || videoInfo.user_name);

      if (success) {
        // 查找下载的文件路径
        const videoPath = await summaryService.findVideoPath(
          job.user_name || videoInfo.user_name,
          job.aweme_id
        );

        let downloadUrl = null;
        if (videoPath) {
          // 生成下载直链
          const filename = path.basename(videoPath);
          const encodedUsername = encodeURIComponent(job.user_name || videoInfo.user_name);
          const encodedFilename = encodeURIComponent(filename);
          downloadUrl = `/api/video/${encodedUsername}/${encodedFilename}`;
        } else {
          // 尝试查找图片
          const imagePaths = await summaryService.findImagePaths(
            job.user_name || videoInfo.user_name,
            job.aweme_id
          );
          if (imagePaths && imagePaths.length > 0) {
            // 返回第一张图片的URL
            const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
            const photosDir = path.join(downloadDir, job.user_name || videoInfo.user_name, 'photos');
            const relativePath = path.relative(photosDir, imagePaths[0]);
            const urlPath = relativePath.split(path.sep).map(part => encodeURIComponent(part)).join('/');
            const encodedUsername = encodeURIComponent(job.user_name || videoInfo.user_name);
            downloadUrl = `/api/image/${encodedUsername}/${urlPath}`;
          }
        }

        // 更新任务状态为完成
        await db.updateDownloadJobStatus(jobId, 'completed', downloadUrl);
        console.log(`下载任务完成: ${jobId}, 下载链接: ${downloadUrl}`);
      } else {
        // 更新任务状态为失败
        await db.updateDownloadJobStatus(jobId, 'failed', null, '下载失败');
        console.error(`下载任务失败: ${jobId}`);
      }
    } catch (error) {
      console.error(`处理下载任务失败 (${jobId}):`, error.message);
      await db.updateDownloadJobStatus(jobId, 'failed', null, error.message);
    }
  }

  /**
   * 启动后台任务处理器
   */
  start() {
    if (this.processingInterval) {
      return; // 已经启动
    }

    console.log('启动下载任务处理器...');
    
    // 立即处理一次
    this.processPendingJobs();

    // 设置定时处理
    this.processingInterval = setInterval(() => {
      this.processPendingJobs();
    }, this.processingIntervalMs);

    console.log(`下载任务处理器已启动，每${this.processingIntervalMs / 1000}秒检查一次`);
  }

  /**
   * 停止后台任务处理器
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('下载任务处理器已停止');
    }
  }

  /**
   * 处理待处理的下载任务
   */
  async processPendingJobs() {
    if (this.isProcessing) {
      return; // 正在处理中，跳过
    }

    try {
      this.isProcessing = true;

      // 优先处理批量下载任务
      const pendingBatchJobs = await db.getPendingBatchDownloadJobs(1);
      if (pendingBatchJobs.length > 0) {
        const batchJob = pendingBatchJobs[0];
        await this.processBatchJob(batchJob.job_id);
      } else {
        // 如果没有批量任务，处理单个任务
        const pendingJobs = await db.getPendingDownloadJobs(1);
        if (pendingJobs.length > 0) {
          const job = pendingJobs[0];
          await this.processJob(job.job_id);
        }
      }
    } catch (error) {
      console.error('处理待处理任务失败:', error.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 处理批量下载任务
   * @param {string} jobId - 批量任务ID
   */
  async processBatchJob(jobId) {
    try {
      const job = await db.getBatchDownloadJob(jobId);
      if (!job) {
        console.error(`批量下载任务不存在: ${jobId}`);
        return;
      }

      // 如果任务已经完成或失败，跳过
      if (job.status === 'completed' || job.status === 'failed') {
        return;
      }

      // 更新状态为处理中
      await db.updateBatchDownloadJobStatus(jobId, 'processing', 0, 0);

      console.log(`开始处理批量下载任务: ${jobId} (共 ${job.total_count} 个作品)`);

      const awemeIds = job.aweme_ids || [];
      const downloadUrls = [];
      let completedCount = 0;
      let failedCount = 0;
      let maxTimestamp = 0;

      // 逐个处理下载
      for (const awemeId of awemeIds) {
        try {
          // 获取作品信息
          const videoInfo = await db.getDownloadStatus(awemeId);
          if (!videoInfo) {
            console.warn(`未找到作品信息: ${awemeId}`);
            failedCount++;
            continue;
          }

          // 记录最大时间戳
          if (videoInfo.create_time && videoInfo.create_time > maxTimestamp) {
            maxTimestamp = videoInfo.create_time;
          }

          // 构建作品数据对象
          let item = null;
          if (videoInfo.video_info) {
            try {
              item = JSON.parse(videoInfo.video_info);
              if (!item.aweme_id) item.aweme_id = videoInfo.aweme_id;
              if (!item.id) item.id = videoInfo.aweme_id;
            } catch (e) {
              console.warn(`解析video_info失败 (${awemeId}):`, e.message);
            }
          }

          // 如果仍然没有有效的item，使用数据库字段构建基本结构
          if (!item || (!item.video && !item.image_list && !item.images)) {
            console.warn(`作品信息不完整，可能无法下载: ${awemeId}`);
            item = {
              aweme_id: videoInfo.aweme_id,
              id: videoInfo.aweme_id,
              desc: videoInfo.description || videoInfo.title,
              user: {
                unique_id: videoInfo.user_id,
                nickname: videoInfo.user_name
              }
            };
          }

          // 执行下载
          const success = await downloader.processItem(item, videoInfo.user_name);

          if (success) {
            // 查找下载的文件路径
            const videoPath = await summaryService.findVideoPath(videoInfo.user_name, awemeId);

            let downloadUrl = null;
            if (videoPath) {
              // 生成下载直链
              const filename = path.basename(videoPath);
              const encodedUsername = encodeURIComponent(videoInfo.user_name);
              const encodedFilename = encodeURIComponent(filename);
              downloadUrl = `/api/video/${encodedUsername}/${encodedFilename}`;
            } else {
              // 尝试查找图片
              const imagePaths = await summaryService.findImagePaths(videoInfo.user_name, awemeId);
              if (imagePaths && imagePaths.length > 0) {
                const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
                const photosDir = path.join(downloadDir, videoInfo.user_name, 'photos');
                const relativePath = path.relative(photosDir, imagePaths[0]);
                const urlPath = relativePath.split(path.sep).map(part => encodeURIComponent(part)).join('/');
                const encodedUsername = encodeURIComponent(videoInfo.user_name);
                downloadUrl = `/api/image/${encodedUsername}/${urlPath}`;
              }
            }

            if (downloadUrl) {
              downloadUrls.push({
                aweme_id: awemeId,
                download_url: downloadUrl
              });
              completedCount++;
            } else {
              failedCount++;
            }
          } else {
            failedCount++;
          }

          // 更新进度
          await db.updateBatchDownloadJobStatus(jobId, 'processing', completedCount, failedCount, downloadUrls);
        } catch (error) {
          console.error(`处理作品 ${awemeId} 失败:`, error.message);
          failedCount++;
          await db.updateBatchDownloadJobStatus(jobId, 'processing', completedCount, failedCount, downloadUrls);
        }
      }

      // 更新token的最后下载时间戳
      if (maxTimestamp > 0 && job.token) {
        await db.updateLastDownloadTimestamp(job.token, maxTimestamp);
      }

      // 更新任务状态为完成
      await db.updateBatchDownloadJobStatus(jobId, 'completed', completedCount, failedCount, downloadUrls);
      console.log(`批量下载任务完成: ${jobId}, 成功: ${completedCount}, 失败: ${failedCount}`);
    } catch (error) {
      console.error(`处理批量下载任务失败 (${jobId}):`, error.message);
      await db.updateBatchDownloadJobStatus(jobId, 'failed', null, null, null, error.message);
    }
  }
}

module.exports = new DownloadTaskProcessor();
