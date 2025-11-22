const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { ensureDirectory, getFileExtension, saveJSON } = require('./utils');
const db = require('./db');
const storage = require('./storage');
require('dotenv').config();

/**
 * 处理文件名，确保文件名安全有效
 * @param {string} filename - 原始文件名
 * @returns {string} 处理后的安全文件名
 */
function sanitizeFilename(filename) {
  // 移除或替换不安全的字符
  let safeName = filename.replace(/[<>"/\\|?*]/g, '_');
  // 移除控制字符
  safeName = safeName.replace(/[\x00-\x1f\x7f]/g, '');
  // 截断过长的文件名（Windows限制为255字符，减去可能的扩展名）
  const maxLength = 150;
  if (safeName.length > maxLength) {
    safeName = safeName.substring(0, maxLength);
  }
  // 如果文件名空了，使用默认名称
  if (!safeName.trim()) {
    safeName = '无标题内容';
  }
  return safeName;
}

class Downloader {
  constructor() {
    this.downloadDir = process.env.DOWNLOAD_DIR || './downloads';
    this.downloadVideo = process.env.DOWNLOAD_VIDEO === 'true';
    this.downloadPhoto = process.env.DOWNLOAD_PHOTO === 'true';
    this.downloadCaption = process.env.DOWNLOAD_CAPTION === 'true';
    this.maxRetry = parseInt(process.env.MAX_RETRY) || 3;
    
    // 初始化下载目录
    this.ensureDownloadDir();
  }

  /**
   * 确保下载目录存在
   */
  async ensureDownloadDir() {
    await ensureDirectory(this.downloadDir);
  }

  /**
   * 下载文件
   * @param {string} url - 文件URL
   * @param {string} filePath - 保存路径
   * @param {number} retryCount - 当前重试次数
   * @returns {Promise<boolean>} 是否下载成功
   */
  async downloadFile(url, filePath, retryCount = 0) {
    try {
      // 确保目标目录存在
      const dirPath = path.dirname(filePath);
      await ensureDirectory(dirPath);

      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const writer = fs.createWriteStream(filePath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          console.log(`下载完成: ${filePath}`);
          try {
            const relativePath = path.relative(this.downloadDir, filePath);
            await storage.syncFile(filePath, relativePath);
          } catch (syncError) {
            console.error(`同步到其他存储后端失败 (${filePath}): ${syncError.message}`);
          }
          resolve(true);
        });
        writer.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error(`下载失败 [${url}]: ${error.message}`);
      
      // 重试逻辑
      if (retryCount < this.maxRetry) {
        console.log(`重试下载 (${retryCount + 1}/${this.maxRetry})...`);
        // 指数退避策略
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.downloadFile(url, filePath, retryCount + 1);
      }
      
      console.error(`达到最大重试次数，放弃下载`);
      return false;
    }
  }

  /**
   * 保存文字描述
   * @param {string} text - 文字内容
   * @param {string} filePath - 保存路径
   */
  async saveCaption(text, filePath) {
    try {
      // 确保目标目录存在
      const dirPath = path.dirname(filePath);
      await ensureDirectory(dirPath);
      
      await fs.writeFile(filePath, text, 'utf8');
      console.log(`文字描述已保存: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`保存文字描述失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 处理单个作品的下载
   * @param {object} item - 作品数据
   * @param {string} username - 用户名
   */
  async processItem(item, username) {
    const userDir = path.join(this.downloadDir, username);
    const videoDir = path.join(userDir, 'videos');
    const photoDir = path.join(userDir, 'photos');
    
    // 确保目录存在
    await ensureDirectory(userDir);
    await ensureDirectory(videoDir);
    await ensureDirectory(photoDir);
    
    // 获取文件名（使用作品文案或默认名称）
    const baseFilename = sanitizeFilename(item.desc || `作品_${item.id || Date.now()}`);
    
    let success = false;
    
    // 保存作品元数据到JSON文件（存储在video目录下）
    const metadataPath = path.join(videoDir, `${baseFilename}.json`);
    await saveJSON(metadataPath, item);
    
    // 检查是否为图片幻灯片类型内容
    const isSlideContent = item.is_slides === true || item.media_type === 42;
    
    if (isSlideContent) {
      console.log(`检测到图片幻灯片类型内容: ${baseFilename}`);
      
      // 为图片幻灯片内容创建单独的文件夹
      const slideDir = path.join(photoDir, baseFilename);
      await ensureDirectory(slideDir);
      
      // 为图片幻灯片内容在对应文件夹中创建元数据文件
      const slideMetadataPath = path.join(slideDir, `${baseFilename}.json`);
      await saveJSON(slideMetadataPath, item);
      
      // 处理images数组中的图片（幻灯片图片）
      if (this.downloadPhoto && item.images && item.images.length > 0) {
        console.log(`处理 ${item.images.length} 张幻灯片图片...`);
        
        for (let i = 0; i < item.images.length; i++) {
          const imgData = item.images[i];
          // 获取图片URL（可能在url_list或其他字段中）
          let imgUrl;
          if (imgData.url_list && imgData.url_list.length > 0) {
            imgUrl = imgData.url_list[0];
          } else if (imgData.download_addr && imgData.download_addr.url_list && imgData.download_addr.url_list.length > 0) {
            imgUrl = imgData.download_addr.url_list[0];
          }
          
          if (imgUrl) {
            const ext = getFileExtension(imgUrl);
            const imgFilename = `${baseFilename}_${i+1}${ext}`;
            const imgPath = path.join(slideDir, imgFilename);
            
            const imgSuccess = await this.downloadFile(imgUrl, imgPath);
            success = success || imgSuccess;
          } else {
            console.warn(`未找到第 ${i+1} 张图片的下载链接`);
          }
        }
      }
    } else {
      // 处理标准视频
      if (this.downloadVideo && item.video && item.video.play_addr) {
        const videoUrl = item.video.play_addr.url_list[0];
        const ext = getFileExtension(videoUrl);
        const videoPath = path.join(videoDir, `${baseFilename}${ext}`);
        
        const videoSuccess = await this.downloadFile(videoUrl, videoPath);
        success = success || videoSuccess;
      }
      
      // 处理标准图片列表
      if (this.downloadPhoto && item.image_list && item.image_list.length > 0) {
        // 为图片作品创建JSON元数据文件
        const photoMetadataPath = path.join(photoDir, `${baseFilename}.json`);
        await saveJSON(photoMetadataPath, item);
        
        for (let i = 0; i < item.image_list.length; i++) {
          const imgUrl = item.image_list[i].url_list[0];
          const ext = getFileExtension(imgUrl);
          // 多图片时添加数字编号
          const imgFilename = item.image_list.length > 1 
            ? `${baseFilename}_${i+1}${ext}` 
            : `${baseFilename}${ext}`;
          const imgPath = path.join(photoDir, imgFilename);
          
          const imgSuccess = await this.downloadFile(imgUrl, imgPath);
          success = success || imgSuccess;
        }
      }
    }
    
    return success;
  }

  /**
   * 处理多个作品的下载
   * @param {array} items - 作品列表
   * @param {string} username - 用户名
   */
  async processItems(items, username) {
    console.log(`开始处理 ${items.length} 个作品...`);
    
    // 获取待下载的作品ID列表
    const pendingItems = await db.getPendingItems(items[0]?.user?.unique_id || 'unknown');
    
    let downloadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    
    for (const item of items) {
      // 检查作品是否已经下载或不在待下载列表中
      const isDownloaded = await db.isItemDownloaded(item.user?.unique_id || 'unknown', item.aweme_id || item.id);
      if (isDownloaded || (!pendingItems.includes(item.aweme_id || item.id) && pendingItems.length > 0)) {
        console.log(`作品 ${item.aweme_id || item.id} 已下载或不在待处理队列中，跳过`);
        skippedCount++;
        continue;
      }
      
      try {
        // 更新状态为下载中
        await db.updateItemStatus(item.aweme_id || item.id, 'downloading');
        
        const success = await this.processItem(item, username);
        
        if (success) {
          await db.updateItemStatus(item.aweme_id || item.id, 'completed');
          // 更新视频完整信息（包括video_info和常用字段）
          try {
            await db.updateVideoInfo(item.aweme_id || item.id, item);
          } catch (error) {
            console.warn(`更新视频信息失败 (${item.aweme_id || item.id}):`, error.message);
            // 不阻止下载流程，只记录警告
          }
          downloadedCount++;
        } else {
          // 获取当前尝试次数
          const attemptCount = 1; // 第一次尝试
          await db.updateItemStatus(item.aweme_id || item.id, 'failed', attemptCount);
          failedCount++;
          console.log(`作品 ${item.aweme_id || item.id} 下载失败`);
        }
      } catch (error) {
        await db.updateItemStatus(item.aweme_id || item.id, 'failed', 1);
        failedCount++;
        console.error(`处理作品 ${item.aweme_id || item.id} 时出错:`, error.message);
      }
      
      // 避免请求过于频繁
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`作品处理统计: 下载成功 ${downloadedCount}, 跳过 ${skippedCount}, 失败 ${failedCount}`);
    return { downloadedCount, skippedCount, failedCount };
  }
}

module.exports = new Downloader();