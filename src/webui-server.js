const express = require('express');
const path = require('path');
const db = require('./db');
const preferenceService = require('./preferenceService');
const summaryService = require('./summaryService');
const videoProcessor = require('./videoProcessor');
const aiAnalyzer = require('./aiAnalyzer');
const tokenAuth = require('./tokenAuth');
require('dotenv').config();

/**
 * Web UI服务器
 * 提供用户界面来选择喜欢的视频
 */
class WebUIServer {
  constructor() {
    this.app = express();
    this.port = parseInt(process.env.WEBUI_PORT) || 3001;
    this.secret = process.env.WEBUI_SECRET || 'default-secret-change-me';
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, '../public')));
    
    // 添加视频文件服务路由
    this.setupVideoRoutes();
  }

  /**
   * 设置视频文件服务路由
   */
  setupVideoRoutes() {
    const fs = require('fs-extra');
    const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
    
    // 提供视频文件流
    this.app.get('/api/video/:username/:filename', async (req, res) => {
      try {
        const { username, filename } = req.params;
        
        // 安全检查：防止路径遍历攻击
        if (filename.includes('..') || username.includes('..')) {
          return res.status(400).send('非法路径');
        }
        
        const videoPath = path.join(downloadDir, username, 'videos', filename);
        
        // 检查文件是否存在
        if (!(await fs.pathExists(videoPath))) {
          return res.status(404).send('视频文件不存在');
        }
        
        const stats = await fs.stat(videoPath);
        const fileSize = stats.size;
        const range = req.headers.range;
        
        // 根据文件扩展名确定Content-Type
        const ext = path.extname(filename).toLowerCase();
        const contentTypeMap = {
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.avi': 'video/x-msvideo',
          '.mkv': 'video/x-matroska',
          '.flv': 'video/x-flv',
          '.webm': 'video/webm'
        };
        const contentType = contentTypeMap[ext] || 'video/mp4';
        
        // 支持范围请求（视频流式播放）
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(videoPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          };
          res.writeHead(200, head);
          fs.createReadStream(videoPath).pipe(res);
        }
      } catch (error) {
        console.error('提供视频文件失败:', error.message);
        res.status(500).send('服务器错误');
      }
    });

    // 提供图片文件
    this.app.get('/api/image/:username/*', async (req, res) => {
      try {
        const username = req.params.username;
        const filepath = req.params[0]; // 获取通配符匹配的路径
        
        // 安全检查：防止路径遍历攻击
        if (filepath.includes('..') || username.includes('..')) {
          return res.status(400).send('非法路径');
        }
        
        const imagePath = path.join(downloadDir, username, 'photos', filepath);
        
        // 检查文件是否存在
        if (!(await fs.pathExists(imagePath))) {
          return res.status(404).send('图片文件不存在');
        }
        
        // 根据文件扩展名确定Content-Type
        const ext = path.extname(filepath).toLowerCase();
        const contentTypeMap = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp'
        };
        const contentType = contentTypeMap[ext] || 'image/jpeg';
        
        const stats = await fs.stat(imagePath);
        const head = {
          'Content-Length': stats.size,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400' // 缓存1天
        };
        res.writeHead(200, head);
        fs.createReadStream(imagePath).pipe(res);
      } catch (error) {
        console.error('提供图片文件失败:', error.message);
        res.status(500).send('服务器错误');
      }
    });
  }

  /**
   * 验证token
   */
  verifyToken(token, date) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(`${date}-${this.secret}`);
    const expectedToken = hash.digest('hex').substring(0, 32);
    return token === expectedToken;
  }

  async processVideosForResponse(unanalyzedVideos) {
      const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
      return await Promise.all(
          unanalyzedVideos.map(async (video) => {
            try {
              // 先尝试查找视频
              const videoPath = await summaryService.findVideoPath(video.user_name, video.aweme_id);
              if (videoPath) {
                const filename = path.basename(videoPath);
                video.mediaType = 'video';
                video.mediaUrl = `/api/video/${encodeURIComponent(video.user_name)}/${encodeURIComponent(filename)}`;
                video.hasMedia = true;
              } else {
                // 尝试查找图片
                const imagePaths = await summaryService.findImagePaths(video.user_name, video.aweme_id);
                if (imagePaths && imagePaths.length > 0) {
                  video.mediaType = 'image';
                  video.imagePaths = imagePaths.map(imgPath => {
                    // 获取相对于photos目录的路径
                    const photosDir = path.join(downloadDir, video.user_name, 'photos');
                    const relativePath = path.relative(photosDir, imgPath);
                    // 转换为URL路径格式
                    const urlPath = relativePath.split(path.sep).map(part => encodeURIComponent(part)).join('/');
                    return `/api/image/${encodeURIComponent(video.user_name)}/${urlPath}`;
                  });
                  video.hasMedia = true;
                } else {
                  video.mediaType = null;
                  video.mediaUrl = null;
                  video.imagePaths = null;
                  video.hasMedia = false;
                }
              }
              
              // 如果视频已分析（is_analyzed = 1），加载分析特征数据
              if (video.is_analyzed === 1) {
                try {
                  const features = await db.getVideoFeatures(video.aweme_id);
                  if (features && features.ai_features) {
                    video.ai_features = features.ai_features;
                    video.isAnalyzed = true;
                  } else {
                    video.isAnalyzed = false;
                  }
                } catch (error) {
                  console.error(`获取分析特征失败 (${video.aweme_id}):`, error.message);
                  video.isAnalyzed = false;
                }
              } else {
                video.isAnalyzed = false;
              }
            } catch (error) {
              console.error(`获取媒体URL失败 (${video.aweme_id}):`, error.message);
              video.mediaType = null;
              video.mediaUrl = null;
              video.imagePaths = null;
              video.hasMedia = false;
              video.isAnalyzed = false;
            }
            return video;
          })
        );
  }

  setupRoutes() {
    // 根路由 - 展示未分析的视频列表
    this.app.get('/', async (req, res) => {
      try {
        // 获取未分析的视频（随机选择）
        const limit = parseInt(req.query.limit) || 5;
        const unanalyzedVideos = await db.getUnanalyzedVideos(limit);
        
        // 为每个作品获取媒体文件URL（视频或图片）和分析数据
        const videosWithUrls = await this.processVideosForResponse(unanalyzedVideos);
        
        // 发送HTML页面
        res.send(this.generateUnanalyzedVideosPage(videosWithUrls));
      } catch (error) {
        console.error('处理请求失败:', error.message);
        res.status(500).send('服务器错误: ' + error.message);
      }
    });

    // API: 获取更多未分析视频 (Infinite Scroll)
    this.app.get('/api/videos/unanalyzed', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 5;
        // TODO: 可以添加 exclude 参数来排除已加载的 ID，但这里暂时利用数据库的随机性
        const unanalyzedVideos = await db.getUnanalyzedVideos(limit);
        const videosWithUrls = await this.processVideosForResponse(unanalyzedVideos);
        
        res.json({
            success: true,
            data: videosWithUrls
        });
      } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // API: 获取最新下载的视频
    this.app.get('/api/videos/latest', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const latestVideos = await db.getLatestDownloadedVideos(limit);
        const videosWithUrls = await this.processVideosForResponse(latestVideos);
        
        res.json({
            success: true,
            data: videosWithUrls
        });
      } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 偏好选择页面
    this.app.get('/preference', async (req, res) => {
      try {
        const { token, date } = req.query;
        
        if (!token || !date) {
          return res.status(400).send('缺少必要参数：token 和 date');
        }

        // 验证token
        if (!this.verifyToken(token, date)) {
          return res.status(403).send('无效的访问令牌');
        }

        // 获取每日总结
        const summary = await db.getDailySummary(date);
        if (!summary) {
          return res.status(404).send('未找到该日期的总结');
        }

        let summaryData;
        try {
          summaryData = JSON.parse(summary.summary_content);
        } catch (e) {
          return res.status(500).send('解析总结数据失败');
        }

        // 发送HTML页面
        res.send(this.generatePreferencePage(summaryData, token, date));
      } catch (error) {
        console.error('处理请求失败:', error.message);
        res.status(500).send('服务器错误');
      }
    });

    // 提交偏好反馈
    this.app.post('/api/feedback', async (req, res) => {
      try {
        const { token, date, feedbacks } = req.body;

        if (!token || !date) {
          return res.status(400).json({ success: false, error: '缺少必要参数' });
        }

        // 验证token
        if (!this.verifyToken(token, date)) {
          return res.status(403).json({ success: false, error: '无效的访问令牌' });
        }

        if (!feedbacks || !Array.isArray(feedbacks)) {
          return res.status(400).json({ success: false, error: '反馈数据格式错误' });
        }

        // 处理反馈
        const results = await preferenceService.processBatchFeedback(feedbacks);

        // 保存反馈到数据库
        for (const feedback of feedbacks) {
          await db.saveUserFeedback(feedback.aweme_id, feedback.feedback_type, date);
        }

        res.json({
          success: true,
          message: '反馈提交成功',
          results
        });
      } catch (error) {
        console.error('处理反馈失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
      }
    });

    // 获取偏好统计（可选API）
    this.app.get('/api/preferences/stats', async (req, res) => {
      try {
        const stats = await preferenceService.getUserPreferenceStats();
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        console.error('获取偏好统计失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
      }
    });

    // 分析视频（提取帧 + AI分析）
    this.app.post('/api/analyze-video', async (req, res) => {
      try {
        const { aweme_id } = req.body;

        if (!aweme_id) {
          return res.status(400).json({ success: false, error: '缺少必要参数：aweme_id' });
        }

        // 检查是否已经分析过
        const existingFeatures = await db.getVideoFeatures(aweme_id);
        if (existingFeatures && existingFeatures.ai_features) {
          return res.json({
            success: true,
            message: '视频已经分析过',
            data: existingFeatures
          });
        }

        // 获取视频信息
        const videoInfo = await db.getDownloadStatus(aweme_id);
        if (!videoInfo) {
          return res.status(404).json({ success: false, error: '未找到视频信息' });
        }

        // 先尝试查找视频文件
        const videoPath = await summaryService.findVideoPath(videoInfo.user_name, aweme_id);
        let result = null;

        if (videoPath) {
          // 处理视频分析
          result = await summaryService.processVideoAnalysis(
            videoInfo.user_name,
            aweme_id,
            videoPath
          );
        } else {
          // 尝试查找图片文件
          const imagePaths = await summaryService.findImagePaths(videoInfo.user_name, aweme_id);
          if (!imagePaths || imagePaths.length === 0) {
            return res.status(404).json({ success: false, error: '未找到视频或图片文件' });
          }

          // 处理图片分析
          result = await summaryService.processImageAnalysis(
            videoInfo.user_name,
            aweme_id,
            imagePaths
          );
        }

        if (!result) {
          return res.status(500).json({ success: false, error: '视频分析失败' });
        }

        res.json({
          success: true,
          message: '视频分析完成',
          data: result
        });
      } catch (error) {
        console.error('分析视频失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 获取视频文件URL
    this.app.get('/api/video-url/:aweme_id', async (req, res) => {
      try {
        const { aweme_id } = req.params;

        // 获取视频信息
        const videoInfo = await db.getDownloadStatus(aweme_id);
        if (!videoInfo) {
          return res.status(404).json({ success: false, error: '未找到视频信息' });
        }

        // 查找视频文件路径
        const videoPath = await summaryService.findVideoPath(videoInfo.user_name, aweme_id);
        if (!videoPath) {
          return res.status(404).json({ success: false, error: '未找到视频文件' });
        }

        // 获取文件名
        const filename = path.basename(videoPath);
        const videoUrl = `/api/video/${encodeURIComponent(videoInfo.user_name)}/${encodeURIComponent(filename)}`;

        res.json({
          success: true,
          url: videoUrl,
          filename: filename
        });
      } catch (error) {
        console.error('获取视频URL失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 保存对未分析视频的偏好反馈
    this.app.post('/api/feedback-unanalyzed', async (req, res) => {
      try {
        const { feedbacks } = req.body;

        if (!feedbacks || !Array.isArray(feedbacks)) {
          return res.status(400).json({ success: false, error: '反馈数据格式错误' });
        }

        // 处理反馈
        const results = [];
        const today = new Date().toISOString().split('T')[0];

        for (const feedback of feedbacks) {
          const { aweme_id, feedback_type } = feedback;

          if (!aweme_id || !feedback_type) {
            continue;
          }

          // 保存反馈到数据库（使用今天的日期作为summary_id）
          await db.saveUserFeedback(aweme_id, feedback_type, today);
          
          // 如果视频已经分析过，更新偏好分数
          const features = await db.getVideoFeatures(aweme_id);
          if (features && features.ai_features) {
            try {
              await preferenceService.processFeedback(aweme_id, feedback_type);
            } catch (e) {
              console.warn(`处理偏好更新失败 (${aweme_id}):`, e.message);
            }
          }

          results.push({ aweme_id, success: true });
        }

        res.json({
          success: true,
          message: '反馈提交成功',
          results
        });
      } catch (error) {
        console.error('处理反馈失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误' });
      }
    });

    // 创建下载任务
    this.app.post('/api/download', async (req, res) => {
      try {
        const { aweme_id, user_id, user_name, download_url } = req.body;

        if (!aweme_id) {
          return res.status(400).json({ success: false, error: '缺少必要参数：aweme_id' });
        }

        // 生成唯一的job_id
        const crypto = require('crypto');
        const jobId = crypto.randomBytes(16).toString('hex');

        // 获取用户信息（如果未提供）
        let userId = user_id;
        let userName = user_name;

        if (!userId || !userName) {
          // 尝试从数据库获取
          const videoInfo = await db.getDownloadStatus(aweme_id);
          if (videoInfo) {
            userId = userId || videoInfo.user_id;
            userName = userName || videoInfo.user_name;
          }
        }

        // 创建下载任务
        await db.createDownloadJob(jobId, aweme_id, userId || 'unknown', userName || 'unknown', download_url || null);

        // 如果提供了download_url，直接标记为completed
        if (download_url) {
          await db.updateDownloadJobStatus(jobId, 'completed', download_url);
        } else {
          // 触发下载任务处理（异步）
          const downloadTaskProcessor = require('./downloadTaskProcessor');
          downloadTaskProcessor.processJob(jobId).catch(err => {
            console.error(`处理下载任务失败 (${jobId}):`, err.message);
          });
        }

        res.json({
          success: true,
          job_id: jobId,
          message: '下载任务已创建'
        });
      } catch (error) {
        console.error('创建下载任务失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 查询下载任务状态
    this.app.get('/api/download/:jobid', async (req, res) => {
      try {
        const { jobid } = req.params;

        const job = await db.getDownloadJob(jobid);
        if (!job) {
          return res.status(404).json({ success: false, error: '未找到下载任务' });
        }

        const response = {
          success: true,
          job_id: job.job_id,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at
        };

        // 如果下载完成，返回下载直链
        if (job.status === 'completed' && job.download_url) {
          response.download_url = job.download_url;
        }

        // 如果失败，返回错误信息
        if (job.status === 'failed' && job.error_message) {
          response.error_message = job.error_message;
        }

        res.json(response);
      } catch (error) {
        console.error('查询下载任务状态失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // ========== 基于Token的下载API ==========

    // 检查新视频（需要token认证）
    this.app.post('/api/videos/check-new', tokenAuth.verifyToken.bind(tokenAuth), async (req, res) => {
      try {
        const { limit = 100, include_completed = false } = req.body;
        const token = req.token;

        // 获取该token用户需要下载的新视频
        const newVideos = await db.getNewVideosForToken(token, limit, include_completed);

        // 格式化返回数据
        const videos = newVideos.map(video => ({
          aweme_id: video.aweme_id,
          user_id: video.user_id,
          user_name: video.user_name,
          title: video.title,
          description: video.description,
          create_time: video.create_time,
          has_video_info: video.has_video_info === 1,
          status: video.status
        }));

        res.json({
          success: true,
          count: videos.length,
          last_download_timestamp: req.tokenInfo.last_download_timestamp || 0,
          videos: videos
        });
      } catch (error) {
        console.error('检查新视频失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 批量下载视频（需要token认证）
    this.app.post('/api/videos/download-batch', tokenAuth.verifyToken.bind(tokenAuth), async (req, res) => {
      try {
        const { aweme_ids } = req.body;
        const token = req.token;

        if (!aweme_ids || !Array.isArray(aweme_ids) || aweme_ids.length === 0) {
          return res.status(400).json({ success: false, error: '缺少必要参数：aweme_ids（数组）' });
        }

        // 生成唯一的job_id
        const crypto = require('crypto');
        const jobId = crypto.randomBytes(16).toString('hex');

        // 创建批量下载任务
        await db.createBatchDownloadJob(jobId, token, aweme_ids);

        // 触发批量下载任务处理（异步）
        const downloadTaskProcessor = require('./downloadTaskProcessor');
        downloadTaskProcessor.processBatchJob(jobId).catch(err => {
          console.error(`处理批量下载任务失败 (${jobId}):`, err.message);
        });

        res.json({
          success: true,
          job_id: jobId,
          total_count: aweme_ids.length,
          message: '批量下载任务已创建'
        });
      } catch (error) {
        console.error('创建批量下载任务失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 查询批量下载任务状态
    this.app.get('/api/videos/download-batch/:jobid', tokenAuth.optionalVerifyToken.bind(tokenAuth), async (req, res) => {
      try {
        const { jobid } = req.params;

        const job = await db.getBatchDownloadJob(jobid);
        if (!job) {
          return res.status(404).json({ success: false, error: '未找到批量下载任务' });
        }

        // 如果提供了token，验证是否是任务所有者
        if (req.token && job.token !== req.token) {
          return res.status(403).json({ success: false, error: '无权访问此任务' });
        }

        const response = {
          success: true,
          job_id: job.job_id,
          status: job.status,
          total_count: job.total_count,
          completed_count: job.completed_count || 0,
          failed_count: job.failed_count || 0,
          created_at: job.created_at,
          updated_at: job.updated_at
        };

        // 如果下载完成，返回下载链接列表
        if (job.status === 'completed' && job.download_urls && job.download_urls.length > 0) {
          response.download_urls = job.download_urls;
        }

        // 如果失败，返回错误信息
        if (job.status === 'failed' && job.error_message) {
          response.error_message = job.error_message;
        }

        res.json(response);
      } catch (error) {
        console.error('查询批量下载任务状态失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // ========== Token管理API ==========

    // 创建或获取token
    this.app.post('/api/tokens', async (req, res) => {
      try {
        const { token, user_name } = req.body;

        if (!token) {
          // 如果没有提供token，自动生成一个
          const crypto = require('crypto');
          const generatedToken = crypto.randomBytes(32).toString('hex');
          await db.createOrUpdateUserToken(generatedToken, user_name);
          const tokenInfo = await db.getUserToken(generatedToken);

          return res.json({
            success: true,
            token: generatedToken,
            token_info: {
              user_name: tokenInfo.user_name,
              last_download_timestamp: tokenInfo.last_download_timestamp,
              created_at: tokenInfo.created_at
            },
            message: 'Token已自动生成'
          });
        }

        // 如果提供了token，创建或更新
        await db.createOrUpdateUserToken(token, user_name);
        const tokenInfo = await db.getUserToken(token);

        res.json({
          success: true,
          token: token,
          token_info: {
            user_name: tokenInfo.user_name,
            last_download_timestamp: tokenInfo.last_download_timestamp,
            created_at: tokenInfo.created_at
          },
          message: 'Token已创建或更新'
        });
      } catch (error) {
        console.error('创建Token失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });

    // 查询token信息
    this.app.get('/api/tokens/:token', async (req, res) => {
      try {
        const { token } = req.params;

        const tokenInfo = await db.getUserToken(token);
        if (!tokenInfo) {
          return res.status(404).json({ success: false, error: 'Token不存在' });
        }

        res.json({
          success: true,
          token: tokenInfo.token,
          user_name: tokenInfo.user_name,
          last_download_timestamp: tokenInfo.last_download_timestamp,
          created_at: tokenInfo.created_at,
          updated_at: tokenInfo.updated_at
        });
      } catch (error) {
        console.error('查询Token信息失败:', error.message);
        res.status(500).json({ success: false, error: '服务器错误: ' + error.message });
      }
    });
  }

  /**
   * 生成偏好选择页面
   */
  generatePreferencePage(summaryData, token, date) {
    const videos = summaryData.videos || [];
    
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>视频偏好选择 - ${date}</title>
  <style>
    /* ... styles ... */
  </style>
</head>
<body>
   <!-- ... existing preference page ... -->
</body>
</html>
    `;
  }

  /**
   * 生成未分析视频页面 (Immersive Mode)
   */
  generateUnanalyzedVideosPage(videos) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>视频分析与管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    
    body {
        font-family: 'Inter', sans-serif;
        background-color: #000;
        color: white;
    }
    
    /* Hide scrollbar */
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }

    .glass-panel {
        background: rgba(25, 25, 25, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .video-container {
        scroll-snap-align: start;
        position: relative;
    }
    
    .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
  </style>
</head>
<body class="h-screen w-full overflow-hidden flex flex-col">
  <!-- Header -->
  <div class="absolute top-0 left-0 w-full z-50 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
    <div class="flex justify-between items-center pointer-events-auto">
        <div class="flex items-center gap-2 text-white/90">
            <i class="fas fa-robot text-blue-500 text-xl"></i>
            <h1 class="font-bold text-lg tracking-wide">AI 视频流</h1>
        </div>
        <div class="flex items-center gap-3">
            <!-- Loading Indicator for Infinite Scroll -->
            <div id="feed-loader" class="hidden">
                <i class="fas fa-circle-notch fa-spin text-blue-500"></i>
            </div>
        </div>
    </div>
  </div>

  <!-- Main Feed -->
  <div class="flex-1 h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar relative" id="feedContainer">
    <!-- Video items will be injected here -->
  </div>

  <!-- Global Loading Overlay -->
  <div id="global-loader" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] hidden flex items-center justify-center flex-col gap-6">
    <div class="relative">
        <div class="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
        <div class="absolute inset-0 flex items-center justify-center">
            <i class="fas fa-robot text-blue-500 text-xl animate-pulse"></i>
        </div>
    </div>
    <p class="text-white font-medium tracking-wider text-lg" id="loader-text">Processing...</p>
  </div>

  <script>
    // Global State
    const videoStates = {}; 
    const loadedIds = new Set();
    let isLoadingMore = false;
    
    // Initial Data from Server
    const initialVideos = ${JSON.stringify(videos)};

    // --- Core Rendering Logic ---
    function renderVideoItem(video) {
        if (loadedIds.has(video.aweme_id)) return '';
        loadedIds.add(video.aweme_id);
        
        const safeAwemeId = String(video.aweme_id).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeUserName = (video.user_name || '未知用户').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 使用author_nickname（如果存在），否则使用user_name
        const authorName = (video.author_nickname || video.user_name || '未知用户').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 视频标题
        const videoTitle = (video.title || video.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // 统计信息
        const diggCount = video.digg_count || 0;
        const commentCount = video.comment_count || 0;
        const shareCount = video.share_count || 0;
        // 格式化数字
        const formatNumber = (num) => {
          if (num >= 10000) return (num / 10000).toFixed(1) + 'w';
          if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
          return num.toString();
        };
        const mediaUrl = video.mediaUrl || '';
        const isAnalyzed = video.isAnalyzed === true && video.ai_features;
        
        // Store Initial State
        if (isAnalyzed) {
             videoStates[safeAwemeId] = { analyzed: true, features: video.ai_features };
        }

        return \`
        <div class="video-container w-full h-full flex items-center justify-center bg-black snap-start relative" id="card-\${safeAwemeId}" data-aweme-id="\${safeAwemeId}">
            
            <!-- Media Player -->
            \${video.mediaType === 'video' ? \`
                <video 
                    src="\${mediaUrl}" 
                    class="h-full w-full object-contain max-h-screen" 
                    loop 
                    playsinline
                    muted
                    autoplay
                    onclick="togglePlay('\${safeAwemeId}')"
                    id="player-\${safeAwemeId}"
                ></video>
            \` : \`
                <img src="\${video.imagePaths ? video.imagePaths[0] : ''}" class="h-full w-full object-contain" />
            \`}

            <!-- Right Sidebar Actions -->
            <div class="absolute right-2 bottom-32 flex flex-col gap-6 items-center z-20 w-16">
                
                <!-- Like Button -->
                <div class="flex flex-col items-center gap-1">
                    <button onclick="handleAction('\${safeAwemeId}', 'like')" 
                            class="w-12 h-12 rounded-full bg-gray-800/60 backdrop-blur-md flex items-center justify-center text-white hover:bg-gray-700 transition active:scale-95 action-btn like-btn"
                            id="btn-like-\${safeAwemeId}">
                        <i class="fas fa-heart text-2xl transition-colors"></i>
                    </button>
                    <span class="text-[10px] font-medium text-white/80 shadow-black drop-shadow-md">喜欢</span>
                </div>

                <!-- Dislike Button -->
                <div class="flex flex-col items-center gap-1">
                    <button onclick="handleAction('\${safeAwemeId}', 'dislike')" 
                            class="w-12 h-12 rounded-full bg-gray-800/60 backdrop-blur-md flex items-center justify-center text-white hover:bg-gray-700 transition active:scale-95 action-btn dislike-btn"
                            id="btn-dislike-\${safeAwemeId}">
                        <i class="fas fa-heart-broken text-2xl transition-colors"></i>
                    </button>
                    <span class="text-[10px] font-medium text-white/80 shadow-black drop-shadow-md">不喜欢</span>
                </div>
            </div>

            <!-- Bottom Info Overlay -->
            <div class="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent px-4 pb-8 pt-24 z-10 pointer-events-none">
                <div class="pointer-events-auto max-w-[85%]">
                    <!-- Author Name -->
                    <div class="flex items-center gap-2 mb-2">
                        <h3 class="font-bold text-lg text-white shadow-black drop-shadow-md text-shadow">@\${authorName}</h3>
                        \${video.author_unique_id && video.author_unique_id !== video.user_name ? \`<span class="text-xs text-white/60 font-normal">(\${safeUserName})</span>\` : ''}
                    </div>
                    
                    <!-- Video Title -->
                    \${videoTitle ? \`
                    <p class="text-white text-sm mb-3 leading-relaxed line-clamp-2 shadow-black drop-shadow-md">
                        \${videoTitle}
                    </p>
                    \` : ''}
                    
                    <!-- Statistics -->
                    \${(diggCount > 0 || commentCount > 0 || shareCount > 0) ? \`
                    <div class="flex items-center gap-4 mb-3 text-white/80 text-xs">
                        \${diggCount > 0 ? \`<div class="flex items-center gap-1">
                            <i class="fas fa-heart text-red-400"></i>
                            <span>\${formatNumber(diggCount)}</span>
                        </div>\` : ''}
                        \${commentCount > 0 ? \`<div class="flex items-center gap-1">
                            <i class="fas fa-comment text-blue-400"></i>
                            <span>\${formatNumber(commentCount)}</span>
                        </div>\` : ''}
                        \${shareCount > 0 ? \`<div class="flex items-center gap-1">
                            <i class="fas fa-share text-green-400"></i>
                            <span>\${formatNumber(shareCount)}</span>
                        </div>\` : ''}
                    </div>
                    \` : ''}
                    
                    <!-- Tags -->
                    <div class="flex flex-wrap gap-2" id="tags-preview-\${safeAwemeId}">
                        \${isAnalyzed && video.ai_features.top_tags ? video.ai_features.top_tags.slice(0,5).map(t => \`<span class="text-xs px-2 py-1 bg-white/20 rounded-md backdrop-blur-sm text-white/90 border border-white/10">#\${t}</span>\`).join('') : ''}
                    </div>
                </div>
            </div>

            <!-- AI Analysis Panel (Default Hidden) - REMOVED -->
        </div>
        \`;
    }

    // Append Videos to DOM
    function appendVideos(videos) {
        const container = document.getElementById('feedContainer');
        const html = videos.map(v => renderVideoItem(v)).join('');
        container.insertAdjacentHTML('beforeend', html);
        
        // Observer new elements
        const newElements = container.querySelectorAll('.video-container:not(.observed)');
        newElements.forEach(el => {
            el.classList.add('observed');
            observer.observe(el);
        });
    }

    // --- Intersection Observer for Playback & Infinite Scroll ---
    const observerOptions = {
        root: document.getElementById('feedContainer'),
        threshold: 0.6
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (video) {
                if (entry.isIntersecting) {
                    video.muted = false; // Try to unmute if possible, but browsers block unmuted autoplay often
                    // We keep it muted by default in HTML, let user unmute. 
                    // OR: we try to play.
                    const playPromise = video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(error => {
                            console.log('Autoplay prevented, muting and retrying');
                            video.muted = true;
                            video.play();
                        });
                    }
                    
                    // Check if this is one of the last elements -> Load More
                    const allCards = document.querySelectorAll('.video-container');
                    if (entry.target === allCards[allCards.length - 2]) {
                        loadMoreVideos();
                    }

                } else {
                    video.pause();
                    video.currentTime = 0; 
                }
            }
        });
    }, observerOptions);

    // --- Infinite Scroll Logic ---
    async function loadMoreVideos() {
        if (isLoadingMore) return;
        isLoadingMore = true;
        document.getElementById('feed-loader').classList.remove('hidden');
        
        try {
            const res = await fetch('/api/videos/unanalyzed?limit=5');
            const data = await res.json();
            if (data.success && data.data.length > 0) {
                // Filter duplicates (just in case backend returns same random ones)
                const newVideos = data.data.filter(v => !loadedIds.has(v.aweme_id));
                if(newVideos.length > 0) {
                    appendVideos(newVideos);
                }
            }
        } catch (e) {
            console.error('Load more failed', e);
        } finally {
            isLoadingMore = false;
            document.getElementById('feed-loader').classList.add('hidden');
        }
    }

    // --- Actions ---

    function togglePlay(awemeId) {
        const video = document.getElementById('player-' + awemeId);
        if (video) {
            if (video.paused) {
                video.play();
                video.muted = false; 
            } else {
                video.pause();
            }
        }
    }

    // --- Real-time Feedback Logic ---
    function handleAction(awemeId, type) {
        // Immediate visual feedback
        const btnLike = document.getElementById('btn-like-' + awemeId);
        const btnDislike = document.getElementById('btn-dislike-' + awemeId);
        
        if (type === 'like') {
            btnLike.querySelector('i').className = 'fas fa-heart text-2xl text-red-500';
            btnLike.classList.add('scale-110');
            btnDislike.querySelector('i').className = 'fas fa-heart-broken text-2xl text-white';
            btnDislike.classList.remove('scale-110');
        } else {
            btnDislike.querySelector('i').className = 'fas fa-heart-broken text-2xl text-yellow-500';
            btnDislike.classList.add('scale-110');
            btnLike.querySelector('i').className = 'fas fa-heart text-2xl text-white';
            btnLike.classList.remove('scale-110');
        }

        // Send Request
        fetch('/api/feedback-unanalyzed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                feedbacks: [{ aweme_id: awemeId, feedback_type: type }] 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Optional: Scroll to next video automatically?
                 const currentCard = document.getElementById('card-' + awemeId);
                 if (currentCard && currentCard.nextElementSibling) {
                     currentCard.nextElementSibling.scrollIntoView({ behavior: 'smooth' });
                 } else {
                     // Try to load more if at end
                     loadMoreVideos();
                 }
            } else {
                console.error('Feedback failed');
                // Revert UI?
            }
        })
        .catch(err => console.error(err));
    }

    // --- Boot ---
    window.onload = () => {
        appendVideos(initialVideos);
        // Try to play first video specifically
        const firstVideo = document.querySelector('video');
        if (firstVideo) {
            firstVideo.muted = true;
            firstVideo.play().catch(e => console.log('Initial play failed', e));
        }
    };
  </script>
</body>
</html>
    `;
  }

  /**
   * 启动服务器
   */
  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`Web UI服务器启动成功: http://localhost:${this.port}`);
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('Web UI服务器已停止');
    }
  }
}

// 如果直接运行此文件，启动服务器
if (require.main === module) {
  const db = require('./db');
  const downloadTaskProcessor = require('./downloadTaskProcessor');
  const app = async () => {
    await db.init();
    // 启动下载任务处理器
    downloadTaskProcessor.start();
    const server = new WebUIServer();
    server.start();
  };
  app();
}

module.exports = WebUIServer;
