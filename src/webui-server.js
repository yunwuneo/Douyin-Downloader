const express = require('express');
const path = require('path');
const db = require('./db');
const preferenceService = require('./preferenceService');
const summaryService = require('./summaryService');
const videoProcessor = require('./videoProcessor');
const aiAnalyzer = require('./aiAnalyzer');
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

  setupRoutes() {
    // 根路由 - 展示未分析的视频列表
    this.app.get('/', async (req, res) => {
      try {
        // 获取未分析的视频（随机选择）
        const limit = parseInt(req.query.limit) || 10;
        const unanalyzedVideos = await db.getUnanalyzedVideos(limit);
        
        // 为每个作品获取媒体文件URL（视频或图片）和分析数据
        const videosWithUrls = await Promise.all(
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
                  const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
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
        
        // 发送HTML页面
        res.send(this.generateUnanalyzedVideosPage(videosWithUrls));
      } catch (error) {
        console.error('处理请求失败:', error.message);
        res.status(500).send('服务器错误: ' + error.message);
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
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      background: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      text-align: center;
    }
    
    .header h1 {
      color: #333;
      margin-bottom: 10px;
    }
    
    .header p {
      color: #666;
    }
    
    .instructions {
      background: white;
      padding: 20px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    .instructions h2 {
      color: #667eea;
      margin-bottom: 10px;
    }
    
    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .video-card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .video-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 6px 12px rgba(0,0,0,0.15);
    }
    
    .video-card.selected-like {
      border: 3px solid #4caf50;
      background: #f1f8f4;
    }
    
    .video-card.selected-dislike {
      border: 3px solid #f44336;
      background: #fff5f5;
    }
    
    .video-card h3 {
      color: #333;
      margin-bottom: 10px;
      font-size: 16px;
    }
    
    .video-meta {
      color: #666;
      font-size: 12px;
      margin-bottom: 10px;
    }
    
    .video-description {
      color: #555;
      font-size: 14px;
      margin-bottom: 15px;
      line-height: 1.5;
      max-height: 100px;
      overflow: hidden;
    }
    
    .tags {
      margin-bottom: 15px;
    }
    
    .tag {
      display: inline-block;
      background: #e3f2fd;
      color: #1976d2;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-right: 5px;
      margin-top: 5px;
    }
    
    .button-group {
      display: flex;
      gap: 10px;
    }
    
    .btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      transition: all 0.2s;
    }
    
    .btn-like {
      background: #4caf50;
      color: white;
    }
    
    .btn-like:hover {
      background: #45a049;
    }
    
    .btn-like.selected {
      background: #2e7d32;
    }
    
    .btn-dislike {
      background: #f44336;
      color: white;
    }
    
    .btn-dislike:hover {
      background: #da190b;
    }
    
    .btn-dislike.selected {
      background: #c62828;
    }
    
    .btn-clear {
      background: #9e9e9e;
      color: white;
    }
    
    .btn-clear:hover {
      background: #757575;
    }
    
    .submit-section {
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      text-align: center;
    }
    
    .submit-btn {
      background: #667eea;
      color: white;
      padding: 15px 40px;
      border: none;
      border-radius: 8px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .submit-btn:hover {
      background: #5568d3;
      transform: scale(1.05);
    }
    
    .submit-btn:disabled {
      background: #ccc;
      cursor: not-allowed;
      transform: none;
    }
    
    .stats {
      margin-top: 20px;
      color: #666;
    }
    
    .loading {
      display: none;
      text-align: center;
      padding: 20px;
      color: #667eea;
    }
    
    .success {
      display: none;
      background: #4caf50;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 视频偏好选择</h1>
      <p>日期: ${date}</p>
      <p>视频数量: ${videos.length}</p>
    </div>
    
    <div class="instructions">
      <h2>📋 使用说明</h2>
      <p>请选择你喜欢的视频（👍）或不喜欢的视频（👎）。你的选择将帮助我们更好地了解你的偏好，从而为你推荐更符合你兴趣的内容。</p>
    </div>
    
    <div class="video-grid" id="videoGrid">
      ${videos.map((video, index) => {
        const features = video.ai_features || {};
        const tags = features.top_tags || [];
        const description = features.description_summary || '暂无描述';
        const safeAwemeId = video.aweme_id.replace(/'/g, "\\'");
        
        return `
      <div class="video-card" data-aweme-id="${safeAwemeId}">
        <h3>${index + 1}. ${(video.user_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h3>
        <div class="video-meta">视频ID: ${safeAwemeId}</div>
        <div class="video-description">${description.substring(0, 150).replace(/</g, '&lt;').replace(/>/g, '&gt;')}${description.length > 150 ? '...' : ''}</div>
        ${tags.length > 0 ? `
        <div class="tags">
          ${tags.slice(0, 5).map(tag => `<span class="tag">${String(tag).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`).join('')}
        </div>
        ` : ''}
        <div class="button-group">
          <button class="btn btn-like" onclick="selectVideo('${safeAwemeId}', 'like')">👍 喜欢</button>
          <button class="btn btn-dislike" onclick="selectVideo('${safeAwemeId}', 'dislike')">👎 不喜欢</button>
          <button class="btn btn-clear" onclick="clearSelection('${safeAwemeId}')">清除</button>
        </div>
      </div>
        `;
      }).join('')}
    </div>
    
    <div class="submit-section">
      <button class="submit-btn" onclick="submitFeedback()">提交反馈</button>
      <div class="stats" id="stats">
        已选择: <span id="selectedCount">0</span> / ${videos.length}
      </div>
      <div class="loading" id="loading">正在提交...</div>
      <div class="success" id="success">
        ✅ 反馈提交成功！感谢你的选择，这将帮助我们更好地为你推荐内容。
      </div>
    </div>
  </div>
  
  <script>
    const feedbacks = {};
    const token = '${token}';
    const date = '${date}';
    
    function selectVideo(awemeId, type) {
      feedbacks[awemeId] = type;
      updateVideoCard(awemeId, type);
      updateStats();
    }
    
    function clearSelection(awemeId) {
      delete feedbacks[awemeId];
      updateVideoCard(awemeId, null);
      updateStats();
    }
    
    function updateVideoCard(awemeId, type) {
      const card = document.querySelector(\`[data-aweme-id="\${awemeId}"]\`);
      const likeBtn = card.querySelector('.btn-like');
      const dislikeBtn = card.querySelector('.btn-dislike');
      
      // 清除所有选中状态
      card.classList.remove('selected-like', 'selected-dislike');
      likeBtn.classList.remove('selected');
      dislikeBtn.classList.remove('selected');
      
      // 添加新的选中状态
      if (type === 'like') {
        card.classList.add('selected-like');
        likeBtn.classList.add('selected');
      } else if (type === 'dislike') {
        card.classList.add('selected-dislike');
        dislikeBtn.classList.add('selected');
      }
    }
    
    function updateStats() {
      const count = Object.keys(feedbacks).length;
      document.getElementById('selectedCount').textContent = count;
    }
    
    async function submitFeedback() {
      const feedbackList = Object.entries(feedbacks).map(([aweme_id, feedback_type]) => ({
        aweme_id,
        feedback_type
      }));
      
      if (feedbackList.length === 0) {
        alert('请至少选择一个视频的偏好！');
        return;
      }
      
      document.getElementById('loading').style.display = 'block';
      document.querySelector('.submit-btn').disabled = true;
      
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token,
            date,
            feedbacks: feedbackList
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          document.getElementById('loading').style.display = 'none';
          document.getElementById('success').style.display = 'block';
          document.querySelector('.submit-btn').disabled = true;
        } else {
          alert('提交失败: ' + (result.error || '未知错误'));
          document.getElementById('loading').style.display = 'none';
          document.querySelector('.submit-btn').disabled = false;
        }
      } catch (error) {
        console.error('提交失败:', error);
        alert('提交失败，请稍后重试');
        document.getElementById('loading').style.display = 'none';
        document.querySelector('.submit-btn').disabled = false;
      }
    }
  </script>
</body>
</html>
    `;
  }

  /**
   * 生成未分析视频页面
   */
  generateUnanalyzedVideosPage(videos) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>未分析视频 - Web UI</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      background: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      text-align: center;
    }
    
    .header h1 {
      color: #333;
      margin-bottom: 10px;
    }
    
    .header p {
      color: #666;
    }
    
    .instructions {
      background: white;
      padding: 20px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    .instructions h2 {
      color: #667eea;
      margin-bottom: 10px;
    }
    
    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .video-card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .video-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 6px 12px rgba(0,0,0,0.15);
    }
    
    .video-card.analyzed {
      border: 3px solid #4caf50;
      background: #f1f8f4;
    }
    
    .video-card.analyzing {
      border: 3px solid #ff9800;
      background: #fff8f0;
    }
    
    .video-card h3 {
      color: #333;
      margin-bottom: 10px;
      font-size: 16px;
    }
    
    .video-meta {
      color: #666;
      font-size: 12px;
      margin-bottom: 10px;
    }
    
    .video-player-container {
      width: 100%;
      margin-bottom: 15px;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
    }
    
    .video-player {
      width: 100%;
      max-height: 400px;
      display: block;
    }
    
    .video-placeholder {
      width: 100%;
      height: 200px;
      background: #f5f5f5;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 15px;
      color: #999;
    }
    
    .video-description {
      color: #555;
      font-size: 14px;
      margin-bottom: 15px;
      min-height: 60px;
      line-height: 1.5;
    }
    
    .video-description.analyzed {
      color: #2e7d32;
    }
    
    .tags {
      margin-bottom: 15px;
    }
    
    .tag {
      display: inline-block;
      background: #e3f2fd;
      color: #1976d2;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-right: 5px;
      margin-top: 5px;
    }
    
    .button-group {
      display: flex;
      gap: 10px;
    }
    
    .btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      transition: all 0.2s;
    }
    
    .btn-analyze {
      background: #2196f3;
      color: white;
    }
    
    .btn-analyze:hover:not(:disabled) {
      background: #1976d2;
    }
    
    .btn-analyze:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    
    .btn-like {
      background: #4caf50;
      color: white;
    }
    
    .btn-like:hover:not(:disabled) {
      background: #45a049;
    }
    
    .btn-like:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    
    .btn-dislike {
      background: #f44336;
      color: white;
    }
    
    .btn-dislike:hover:not(:disabled) {
      background: #da190b;
    }
    
    .btn-dislike:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    
    .btn.selected {
      opacity: 0.7;
      transform: scale(0.95);
    }
    
    .status {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      margin-top: 10px;
    }
    
    .status.pending {
      background: #fff3cd;
      color: #856404;
    }
    
    .status.analyzing {
      background: #ffe0b2;
      color: #e65100;
    }
    
    .status.analyzed {
      background: #c8e6c9;
      color: #2e7d32;
    }
    
    .no-videos {
      background: white;
      padding: 40px;
      border-radius: 10px;
      text-align: center;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    .no-videos h2 {
      color: #333;
      margin-bottom: 10px;
    }
    
    .no-videos p {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 视频分析与管理</h1>
      <p>优先展示已分析但未标记喜好的视频，以节省判断时间</p>
      <p style="margin-top: 10px;">视频数量: <span id="videoCount">${videos.length}</span></p>
    </div>
    
    <div class="instructions">
      <h2>📋 使用说明</h2>
      <p><strong>提示：已分析但未标记喜好的视频会优先显示在顶部</strong></p>
      <p>1. 对于未分析的视频，点击"开始分析"按钮，系统将自动提取视频帧并使用AI分析视频特征</p>
      <p>2. 已分析的视频会自动显示分析结果（描述和标签）</p>
      <p>3. 分析完成后，你可以选择喜欢（👍）或不喜欢的视频（👎）</p>
      <p>4. 你的选择将帮助我们更好地了解你的偏好，从而为你推荐更符合你兴趣的内容</p>
    </div>
    
    ${videos.length === 0 ? `
    <div class="no-videos">
      <h2>🎉 太棒了！</h2>
      <p>所有视频都已经分析并标记了喜好！</p>
      <p style="margin-top: 10px;">新下载的视频会在下次刷新时出现。</p>
    </div>
    ` : `
    <div class="video-grid" id="videoGrid">
      ${videos.map((video, index) => {
        const safeAwemeId = String(video.aweme_id).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeUserName = (video.user_name || '未知用户').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const mediaType = video.mediaType || null;
        const hasMedia = video.hasMedia || false;
        const mediaUrl = video.mediaUrl || null;
        const imagePaths = video.imagePaths || [];
        const isAnalyzed = video.isAnalyzed === true && video.ai_features;
        const aiFeatures = video.ai_features || {};
        const description = aiFeatures.description_summary || aiFeatures.description || '';
        const tags = aiFeatures.top_tags || aiFeatures.tags || [];
        const cardClass = isAnalyzed ? 'analyzed' : '';
        const analyzeBtnText = isAnalyzed ? '已分析' : '开始分析';
        const analyzeBtnDisabled = isAnalyzed ? 'disabled' : '';
        const likeBtnDisabled = (hasMedia && isAnalyzed) ? '' : 'disabled';
        const dislikeBtnDisabled = (hasMedia && isAnalyzed) ? '' : 'disabled';
        const statusClass = isAnalyzed ? 'analyzed' : 'pending';
        const statusText = isAnalyzed ? '已分析' : '未分析';
        const descHtml = isAnalyzed 
          ? `<span class="status ${statusClass}">${statusText}</span><br><div style="margin-top: 10px;">${description.substring(0, 150).replace(/</g, '&lt;').replace(/>/g, '&gt;')}${description.length > 150 ? '...' : ''}</div>`
          : `<span class="status ${statusClass}">${statusText}</span>`;
        const tagsHtml = isAnalyzed && tags.length > 0
          ? tags.slice(0, 5).map(tag => `<span class="tag">${String(tag).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`).join('')
          : '';
        const tagsDisplay = isAnalyzed && tags.length > 0 ? 'block' : 'none';
        
        return `
      <div class="video-card ${cardClass}" data-aweme-id="${safeAwemeId}" id="card-${safeAwemeId}">
        <h3>${index + 1}. ${safeUserName}</h3>
        <div class="video-meta">作品ID: ${safeAwemeId}</div>
        <div class="video-meta">类型: ${mediaType === 'video' ? '视频' : mediaType === 'image' ? '图片' : '未知'}</div>
        <div class="video-meta">下载时间: ${new Date(video.created_at).toLocaleString('zh-CN')}</div>
        ${hasMedia && mediaType === 'video' ? `
        <div class="video-player-container">
          <video class="video-player" controls preload="metadata" id="player-${safeAwemeId}" playsinline>
            <source src="${mediaUrl}" type="video/mp4">
            您的浏览器不支持视频播放
          </video>
        </div>
        ` : hasMedia && mediaType === 'image' && imagePaths.length > 0 ? `
        <div class="image-gallery-container">
          ${imagePaths.length === 1 ? `
          <img src="${imagePaths[0]}" alt="图片" class="single-image" id="image-${safeAwemeId}">
          ` : `
          <div class="image-carousel" id="carousel-${safeAwemeId}">
            ${imagePaths.map((imgUrl, imgIndex) => `
            <div class="carousel-item ${imgIndex === 0 ? 'active' : ''}" data-index="${imgIndex}">
              <img src="${imgUrl}" alt="图片 ${imgIndex + 1}">
            </div>
            `).join('')}
            <div class="carousel-nav">
              <button class="carousel-btn prev" onclick="prevImage('${safeAwemeId}')">‹</button>
              <span class="carousel-counter">1 / ${imagePaths.length}</span>
              <button class="carousel-btn next" onclick="nextImage('${safeAwemeId}')">›</button>
            </div>
          </div>
          `}
        </div>
        ` : `
        <div class="video-placeholder">
          <p>媒体文件未找到或不可用</p>
        </div>
        `}
        <div class="video-description ${isAnalyzed ? 'analyzed' : ''}" id="desc-${safeAwemeId}">
          ${descHtml}
        </div>
        <div class="tags" id="tags-${safeAwemeId}" style="display: ${tagsDisplay};">${tagsHtml}</div>
        <div class="button-group">
          <button class="btn btn-analyze" onclick="analyzeVideo('${safeAwemeId}')" id="btn-analyze-${safeAwemeId}" ${analyzeBtnDisabled}>${analyzeBtnText}</button>
          <button class="btn btn-like" onclick="selectVideo('${safeAwemeId}', 'like')" id="btn-like-${safeAwemeId}" ${likeBtnDisabled}>👍</button>
          <button class="btn btn-dislike" onclick="selectVideo('${safeAwemeId}', 'dislike')" id="btn-dislike-${safeAwemeId}" ${dislikeBtnDisabled}>👎</button>
        </div>
      </div>
        `;
      }).join('')}
    </div>
    
    <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <button class="btn btn-analyze" onclick="submitAllFeedback()" style="padding: 15px 40px; font-size: 18px;">提交所有反馈</button>
      <div style="margin-top: 15px; color: #666;">
        已选择: <span id="selectedCount">0</span> / ${videos.length}
      </div>
      <div id="submitResult" style="margin-top: 15px;"></div>
    </div>
    `}
  </div>
  
  <script>
    const videoStates = {}; // 存储视频的分析状态和偏好
    const feedbacks = {}; // 存储用户的偏好反馈
    
    function analyzeVideo(awemeId) {
      const card = document.getElementById('card-' + awemeId);
      const descEl = document.getElementById('desc-' + awemeId);
      const tagsEl = document.getElementById('tags-' + awemeId);
      const btnAnalyze = document.getElementById('btn-analyze-' + awemeId);
      const btnLike = document.getElementById('btn-like-' + awemeId);
      const btnDislike = document.getElementById('btn-dislike-' + awemeId);
      
      // 设置分析中状态
      card.classList.add('analyzing');
      card.classList.remove('analyzed');
      btnAnalyze.disabled = true;
      btnAnalyze.textContent = '分析中...';
      descEl.innerHTML = '<span class="status analyzing">正在分析视频帧并使用AI提取特征...</span>';
      
      // 发送分析请求
      fetch('/api/analyze-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ aweme_id: awemeId })
      })
      .then(response => response.json())
      .then(result => {
        if (result.success) {
          // 分析成功
          card.classList.remove('analyzing');
          card.classList.add('analyzed');
          btnAnalyze.textContent = '已分析';
          btnLike.disabled = false;
          btnDislike.disabled = false;
          
          const features = result.data.ai_features || {};
          const description = features.description_summary || features.description || '暂无描述';
          const tags = features.top_tags || features.tags || [];
          
          descEl.innerHTML = '<span class="status analyzed">已分析</span><br>' + 
            '<div style="margin-top: 10px;">' + description.substring(0, 150) + (description.length > 150 ? '...' : '') + '</div>';
          descEl.classList.add('analyzed');
          
          if (tags.length > 0) {
            tagsEl.innerHTML = tags.slice(0, 5).map(tag => 
              '<span class="tag">' + String(tag).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>'
            ).join('');
            tagsEl.style.display = 'block';
          }
          
          videoStates[awemeId] = {
            analyzed: true,
            features: features
          };
        } else {
          // 分析失败
          card.classList.remove('analyzing');
          btnAnalyze.disabled = false;
          btnAnalyze.textContent = '分析失败，重试';
          descEl.innerHTML = '<span class="status pending" style="background: #ffcdd2; color: #c62828;">分析失败: ' + (result.error || '未知错误') + '</span>';
        }
      })
      .catch(error => {
        console.error('分析视频失败:', error);
        card.classList.remove('analyzing');
        btnAnalyze.disabled = false;
        btnAnalyze.textContent = '分析失败，重试';
        descEl.innerHTML = '<span class="status pending" style="background: #ffcdd2; color: #c62828;">分析失败: ' + error.message + '</span>';
      });
    }
    
    function selectVideo(awemeId, type) {
      // 检查视频是否已分析：查看videoStates或页面上的卡片类名
      const card = document.getElementById('card-' + awemeId);
      const isAnalyzed = (videoStates[awemeId] && videoStates[awemeId].analyzed) || 
                        (card && card.classList.contains('analyzed'));
      
      if (!isAnalyzed) {
        alert('请先完成视频分析！');
        return;
      }
      
      feedbacks[awemeId] = type;
      updateVideoButtons(awemeId, type);
      updateStats();
    }
    
    function updateVideoButtons(awemeId, type) {
      const btnLike = document.getElementById('btn-like-' + awemeId);
      const btnDislike = document.getElementById('btn-dislike-' + awemeId);
      
      // 清除所有选中状态
      btnLike.classList.remove('selected');
      btnDislike.classList.remove('selected');
      
      // 添加新的选中状态
      if (type === 'like') {
        btnLike.classList.add('selected');
      } else if (type === 'dislike') {
        btnDislike.classList.add('selected');
      }
    }
    
    function updateStats() {
      const count = Object.keys(feedbacks).length;
      document.getElementById('selectedCount').textContent = count;
    }
    
    async function submitAllFeedback() {
      const feedbackList = Object.entries(feedbacks).map(([aweme_id, feedback_type]) => ({
        aweme_id,
        feedback_type
      }));
      
      if (feedbackList.length === 0) {
        alert('请至少选择一个视频的偏好！');
        return;
      }
      
      const resultEl = document.getElementById('submitResult');
      resultEl.innerHTML = '<div style="color: #2196f3;">正在提交反馈...</div>';
      
      try {
        const response = await fetch('/api/feedback-unanalyzed', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            feedbacks: feedbackList
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          resultEl.innerHTML = '<div style="color: #4caf50; font-weight: bold;">✅ 反馈提交成功！感谢你的选择，这将帮助我们更好地为你推荐内容。</div>';
          // 清空反馈记录
          Object.keys(feedbacks).forEach(key => delete feedbacks[key]);
          updateStats();
          // 刷新页面以获取新的未分析视频
          setTimeout(() => {
            location.reload();
          }, 2000);
        } else {
          resultEl.innerHTML = '<div style="color: #f44336;">❌ 提交失败: ' + (result.error || '未知错误') + '</div>';
        }
      } catch (error) {
        console.error('提交失败:', error);
        resultEl.innerHTML = '<div style="color: #f44336;">❌ 提交失败，请稍后重试</div>';
      }
    }
    
    // 图片轮播功能
    const carouselStates = {}; // 存储每个作品的照片轮播状态
    
    function prevImage(awemeId) {
      const carousel = document.getElementById('carousel-' + awemeId);
      if (!carousel) return;
      
      const items = carousel.querySelectorAll('.carousel-item');
      const counter = carousel.querySelector('.carousel-counter');
      let currentIndex = 0;
      
      items.forEach((item, index) => {
        if (item.classList.contains('active')) {
          currentIndex = index;
        }
      });
      
      const newIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[currentIndex].classList.remove('active');
      items[newIndex].classList.add('active');
      counter.textContent = (newIndex + 1) + ' / ' + items.length;
    }
    
    function nextImage(awemeId) {
      const carousel = document.getElementById('carousel-' + awemeId);
      if (!carousel) return;
      
      const items = carousel.querySelectorAll('.carousel-item');
      const counter = carousel.querySelector('.carousel-counter');
      let currentIndex = 0;
      
      items.forEach((item, index) => {
        if (item.classList.contains('active')) {
          currentIndex = index;
        }
      });
      
      const newIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items[currentIndex].classList.remove('active');
      items[newIndex].classList.add('active');
      counter.textContent = (newIndex + 1) + ' / ' + items.length;
    }
    
    // 页面加载时，初始化已分析视频的状态
    ${videos.map((video) => {
      if (video.isAnalyzed && video.ai_features) {
        const safeAwemeId = String(video.aweme_id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        // 安全地序列化JSON数据，使用JSON.stringify然后转义引号和反斜杠
        const featuresJson = JSON.stringify(video.ai_features)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e');
        return `videoStates['${safeAwemeId}'] = {
          analyzed: true,
          features: JSON.parse('${featuresJson}')
        };`;
      }
      return '';
    }).filter(s => s).join('\n    ')}
    
    // 页面加载时更新统计
    updateStats();
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
  const app = async () => {
    await db.init();
    const server = new WebUIServer();
    server.start();
  };
  app();
}

module.exports = WebUIServer;
