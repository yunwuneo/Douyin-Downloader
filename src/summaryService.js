const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const videoProcessor = require('./videoProcessor');
const aiAnalyzer = require('./aiAnalyzer');
require('dotenv').config();

/**
 * 每日总结服务
 * 负责生成每日视频下载总结、处理视频分析等
 */
class SummaryService {
  constructor() {
    this.downloadDir = process.env.DOWNLOAD_DIR || './downloads';
  }

  /**
   * 生成WebUI访问token
   */
  generateWebUIToken(date) {
    const secret = process.env.WEBUI_SECRET || 'default-secret-change-me';
    const hash = crypto.createHash('sha256');
    hash.update(`${date}-${secret}`);
    return hash.digest('hex').substring(0, 32);
  }

  /**
   * 查找视频文件路径
   */
  async findVideoPath(username, aweme_id) {
    try {
      const userDir = path.join(this.downloadDir, username, 'videos');
      const fs = require('fs-extra');
      
      if (!(await fs.pathExists(userDir))) {
        return null;
      }

      // 读取目录下的所有文件
      const files = await fs.readdir(userDir);
      
      // 查找匹配的视频文件（可能是mp4、mov等格式）
      for (const file of files) {
        const filePath = path.join(userDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          const ext = path.extname(file).toLowerCase();
          // 检查是否是视频文件
          if (['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm'].includes(ext)) {
            // 检查文件名是否包含aweme_id或对应的JSON文件
            const jsonFile = file.replace(ext, '.json');
            const jsonPath = path.join(userDir, jsonFile);
            
            if (await fs.pathExists(jsonPath)) {
              const metadata = await fs.readJSON(jsonPath);
              if (metadata.aweme_id === aweme_id) {
                return filePath;
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`查找视频文件失败 (${username}, ${aweme_id}):`, error.message);
      return null;
    }
  }

  /**
   * 查找图片文件路径（支持多图）
   */
  async findImagePaths(username, aweme_id) {
    try {
      const fs = require('fs-extra');
      const photoDir = path.join(this.downloadDir, username, 'photos');
      
      if (!(await fs.pathExists(photoDir))) {
        return null;
      }

      // 方案1: 查找标准图片列表（在photos目录下）
      const files = await fs.readdir(photoDir);
      const imageFiles = [];
      
      // 查找匹配的JSON元数据文件
      for (const file of files) {
        if (path.extname(file).toLowerCase() === '.json') {
          const jsonPath = path.join(photoDir, file);
          try {
            const metadata = await fs.readJSON(jsonPath);
            if (metadata.aweme_id === aweme_id) {
              // 找到匹配的元数据文件，查找对应的图片
              const baseFilename = path.basename(file, '.json');
              
              // 检查是否是单图或多图
              const singleImagePath = path.join(photoDir, `${baseFilename}.jpg`);
              if (await fs.pathExists(singleImagePath)) {
                imageFiles.push(singleImagePath);
              } else {
                // 多图情况，查找编号的图片
                let i = 1;
                while (true) {
                  const imagePath = path.join(photoDir, `${baseFilename}_${i}.jpg`);
                  if (await fs.pathExists(imagePath)) {
                    imageFiles.push(imagePath);
                    i++;
                  } else {
                    break;
                  }
                }
              }
              
              if (imageFiles.length > 0) {
                return imageFiles;
              }
            }
          } catch (e) {
            // 忽略JSON解析错误
            continue;
          }
        }
      }
      
      // 方案2: 查找幻灯片类型（在子目录中）
      for (const item of files) {
        const itemPath = path.join(photoDir, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          // 检查子目录中的JSON文件
          const jsonPath = path.join(itemPath, `${item}.json`);
          if (await fs.pathExists(jsonPath)) {
            try {
              const metadata = await fs.readJSON(jsonPath);
              if (metadata.aweme_id === aweme_id) {
                // 查找子目录中的所有图片文件
                const subFiles = await fs.readdir(itemPath);
                for (const subFile of subFiles) {
                  const ext = path.extname(subFile).toLowerCase();
                  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                    imageFiles.push(path.join(itemPath, subFile));
                  }
                }
                
                if (imageFiles.length > 0) {
                  return imageFiles.sort(); // 排序以确保顺序
                }
              }
            } catch (e) {
              continue;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`查找图片文件失败 (${username}, ${aweme_id}):`, error.message);
      return null;
    }
  }

  /**
   * 处理图片分析（直接AI分析图片）
   */
  async processImageAnalysis(username, aweme_id, imagePaths) {
    try {
      console.log(`开始处理图片分析: ${aweme_id} (${imagePaths.length} 张图片)`);

      // 检查是否已经分析过
      const existingFeatures = await db.getVideoFeatures(aweme_id);
      if (existingFeatures && existingFeatures.ai_features) {
        console.log(`图片 ${aweme_id} 已经分析过，跳过`);
        return existingFeatures;
      }

      // AI分析图片（直接分析，不需要提取帧）
      console.log(`AI分析 ${imagePaths.length} 张图片...`);
      const analysis = await aiAnalyzer.analyzeFrames(imagePaths);

      if (!analysis || !analysis.merged) {
        console.warn(`AI分析失败: ${aweme_id}`);
        return null;
      }

      // 保存图片路径（使用第一个图片路径作为主路径）
      const mainImagePath = imagePaths[0];

      // 保存合并后的特征（media_type设为'image'）
      await db.saveVideoFeatures(aweme_id, mainImagePath, analysis.merged, imagePaths.length, 'image');

      console.log(`图片分析完成: ${aweme_id}`);
      return {
        aweme_id,
        video_path: mainImagePath,
        image_paths: imagePaths,
        ai_features: analysis.merged,
        frame_count: imagePaths.length,
        media_type: 'image'
      };
    } catch (error) {
      console.error(`处理图片分析时出错 (${aweme_id}):`, error.message);
      return null;
    }
  }

  /**
   * 处理视频分析（提取帧 + AI分析）
   */
  async processVideoAnalysis(username, aweme_id, videoPath) {
    try {
      console.log(`开始处理视频分析: ${aweme_id}`);

      // 检查是否已经分析过
      const existingFeatures = await db.getVideoFeatures(aweme_id);
      if (existingFeatures && existingFeatures.ai_features) {
        console.log(`视频 ${aweme_id} 已经分析过，跳过`);
        return existingFeatures;
      }

      // 提取视频帧
      console.log(`提取视频帧: ${videoPath}`);
      const frames = await videoProcessor.processVideo(videoPath, aweme_id);

      if (frames.length === 0) {
        console.warn(`未能提取视频帧: ${aweme_id}`);
        return null;
      }

      // AI分析帧
      console.log(`AI分析 ${frames.length} 帧...`);
      const framePaths = frames.map(f => f.path);
      const analysis = await aiAnalyzer.analyzeFrames(framePaths);

      if (!analysis || !analysis.merged) {
        console.warn(`AI分析失败: ${aweme_id}`);
        return null;
      }

      // 保存帧分析结果到数据库
      for (let i = 0; i < frames.length; i++) {
        const frameAnalysis = analysis.frames[i];
        if (frameAnalysis) {
          await db.saveVideoFrame(
            aweme_id,
            frames[i].index,
            frames[i].path,
            frameAnalysis.description || JSON.stringify(frameAnalysis)
          );
        }
      }

      // 保存合并后的特征（media_type设为'video'）
      await db.saveVideoFeatures(aweme_id, videoPath, analysis.merged, frames.length, 'video');

      console.log(`视频分析完成: ${aweme_id}`);
      return {
        aweme_id,
        video_path: videoPath,
        ai_features: analysis.merged,
        frame_count: frames.length,
        media_type: 'video'
      };
    } catch (error) {
      console.error(`处理视频分析时出错 (${aweme_id}):`, error.message);
      return null;
    }
  }

  /**
   * 获取今日下载的视频并分析
   */
  async processTodayVideos(date) {
    try {
      const dateStr = date || new Date().toISOString().split('T')[0];
      console.log(`开始处理今日视频: ${dateStr}`);

      // 获取今日下载的视频列表
      const videos = await db.getTodayDownloadedVideos(dateStr);

      if (videos.length === 0) {
        console.log(`今日没有下载的视频: ${dateStr}`);
        return [];
      }

      console.log(`找到 ${videos.length} 个今日下载的视频`);

      // 处理每个视频的分析
      const processedVideos = [];
      
      for (const video of videos) {
        try {
          // 查找视频文件
          const videoPath = await this.findVideoPath(video.user_name, video.aweme_id);
          
          if (videoPath) {
            // 处理视频分析
            const analysis = await this.processVideoAnalysis(
              video.user_name,
              video.aweme_id,
              videoPath
            );

            if (analysis) {
              processedVideos.push({
                ...video,
                video_path: videoPath,
                ai_features: analysis.ai_features
              });
            } else {
              processedVideos.push(video);
            }
          } else {
            console.warn(`未找到视频文件: ${video.user_name}/${video.aweme_id}`);
            processedVideos.push(video);
          }

          // 避免处理过快
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`处理视频失败 (${video.aweme_id}):`, error.message);
          processedVideos.push(video);
        }
      }

      return processedVideos;
    } catch (error) {
      console.error(`处理今日视频时出错:`, error.message);
      return [];
    }
  }

  /**
   * 根据用户偏好对视频排序
   */
  async sortVideosByPreference(videos) {
    try {
      // 为每个视频计算偏好分数
      const videosWithScores = await Promise.all(
        videos.map(async (video) => {
          const score = await db.calculateVideoPreferenceScore(video.aweme_id);
          return {
            ...video,
            preference_score: score || 0
          };
        })
      );

      // 按分数排序（高到低）
      videosWithScores.sort((a, b) => b.preference_score - a.preference_score);

      return videosWithScores;
    } catch (error) {
      console.error(`排序视频失败:`, error.message);
      return videos; // 如果失败，返回原始列表
    }
  }

  /**
   * 生成每日总结
   */
  async generateDailySummary(date) {
    try {
      const dateStr = date || new Date().toISOString().split('T')[0];
      console.log(`生成每日总结: ${dateStr}`);

      // 处理今日视频
      const videos = await this.processTodayVideos(dateStr);

      if (videos.length === 0) {
        console.log(`今日没有视频需要总结`);
        return null;
      }

      // 根据偏好排序视频
      const sortedVideos = await this.sortVideosByPreference(videos);

      // 生成WebUI token
      const webuiToken = this.generateWebUIToken(dateStr);

      // 保存总结到数据库
      const summaryContent = JSON.stringify({
        date: dateStr,
        videoCount: videos.length,
        videos: sortedVideos
      });

      await db.saveDailySummary(dateStr, summaryContent, videos.length, webuiToken);

      console.log(`每日总结生成完成: ${dateStr}`);
      return {
        date: dateStr,
        videoCount: videos.length,
        videos: sortedVideos,
        webuiToken,
        summaryId: dateStr
      };
    } catch (error) {
      console.error(`生成每日总结失败:`, error.message);
      return null;
    }
  }
}

module.exports = new SummaryService();


