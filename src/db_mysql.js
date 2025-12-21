const mysql = require('mysql2/promise');
const path = require('path');

class MySQLDatabase {
  constructor() {
    this.pool = null;
  }

  /**
   * 初始化数据库连接
   */
  async init() {
    // 从环境变量获取配置
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'douyin_downloader',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '+08:00',
      dateStrings: true // 返回字符串格式的时间，保持与SQLite行为一致
    };

    try {
      // 先尝试连接到服务器（不带数据库名）以创建数据库
      const tempConnection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password
      });

      await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await tempConnection.end();

      // 创建连接池
      this.pool = mysql.createPool(config);
      
      console.log(`MySQL数据库连接成功: ${config.host}:${config.port}/${config.database}`);
      
      // 创建表
      await this.createTables();
      console.log('数据库表检查/创建完成');
      
      // 执行数据库迁移
      await this.checkAndAddColumns();
      
    } catch (err) {
      console.error('连接MySQL数据库失败:', err.message);
      throw err;
    }
  }

  /**
   * 创建数据库表
   */
  async createTables() {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      // 创建下载状态表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS download_status (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(64) NOT NULL,
          user_name VARCHAR(255) NOT NULL,
          aweme_id VARCHAR(64) NOT NULL,
          status VARCHAR(32) DEFAULT 'pending',
          max_cursor BIGINT DEFAULT 0,
          attempt_count INT DEFAULT 0,
          last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_aweme (user_id, aweme_id),
          INDEX idx_user_id (user_id),
          INDEX idx_aweme_id (aweme_id),
          INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建视频特征表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS video_features (
          id INT AUTO_INCREMENT PRIMARY KEY,
          aweme_id VARCHAR(64) NOT NULL UNIQUE,
          video_path TEXT,
          description TEXT,
          ai_features LONGTEXT,
          frame_count INT DEFAULT 0,
          media_type VARCHAR(32) DEFAULT 'video',
          analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_features_aweme_id (aweme_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建视频帧表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS video_frames (
          id INT AUTO_INCREMENT PRIMARY KEY,
          aweme_id VARCHAR(64) NOT NULL,
          frame_index INT NOT NULL,
          frame_path TEXT NOT NULL,
          ai_description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_aweme_frame (aweme_id, frame_index)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建用户偏好表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id INT AUTO_INCREMENT PRIMARY KEY,
          feature_key VARCHAR(128) NOT NULL,
          feature_value VARCHAR(255) NOT NULL,
          preference_score FLOAT DEFAULT 0.0,
          sample_count INT DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_feature (feature_key, feature_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建用户反馈表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS user_feedback (
          id INT AUTO_INCREMENT PRIMARY KEY,
          aweme_id VARCHAR(64) NOT NULL,
          feedback_type VARCHAR(32) NOT NULL,
          summary_id VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_feedback_aweme_id (aweme_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建每日总结表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS daily_summaries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          summary_date VARCHAR(32) NOT NULL UNIQUE,
          summary_content MEDIUMTEXT,
          video_count INT DEFAULT 0,
          email_sent TINYINT DEFAULT 0,
          webui_token VARCHAR(128),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_summary_date (summary_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建下载任务表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS download_jobs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          job_id VARCHAR(64) NOT NULL UNIQUE,
          aweme_id VARCHAR(64),
          user_id VARCHAR(64),
          user_name VARCHAR(255),
          status VARCHAR(32) DEFAULT 'pending',
          download_url TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_job_id (job_id),
          INDEX idx_status (status),
          INDEX idx_aweme_id (aweme_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建用户token表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS user_tokens (
          id INT AUTO_INCREMENT PRIMARY KEY,
          token VARCHAR(128) NOT NULL UNIQUE,
          user_name VARCHAR(255),
          last_download_timestamp BIGINT DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_token (token),
          INDEX idx_last_download (last_download_timestamp)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 创建批量下载任务表
      await connection.query(`
        CREATE TABLE IF NOT EXISTS batch_download_jobs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          job_id VARCHAR(64) NOT NULL UNIQUE,
          token VARCHAR(128) NOT NULL,
          aweme_ids TEXT,
          total_count INT DEFAULT 0,
          completed_count INT DEFAULT 0,
          failed_count INT DEFAULT 0,
          status VARCHAR(32) DEFAULT 'pending',
          download_urls TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_job_id (job_id),
          INDEX idx_token (token),
          INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * 检查并添加缺失的列（数据库迁移）
   */
  async checkAndAddColumns() {
    try {
      // 检查 video_features 表是否有 media_type 列
      const [columns] = await this.pool.query("SHOW COLUMNS FROM video_features LIKE 'media_type'");
      
      if (columns.length === 0) {
        console.log('检测到 video_features 表缺少 media_type 列，正在添加...');
        await this.pool.query("ALTER TABLE video_features ADD COLUMN media_type VARCHAR(32) DEFAULT 'video'");
        console.log('成功添加 media_type 列到 video_features 表');
      }

      // 检查 download_status 表是否有 video_info 列
      const [videoInfoColumns] = await this.pool.query("SHOW COLUMNS FROM download_status LIKE 'video_info'");
      
      if (videoInfoColumns.length === 0) {
        console.log('检测到 download_status 表缺少 video_info 列，正在添加...');
        await this.pool.query("ALTER TABLE download_status ADD COLUMN video_info LONGTEXT");
        console.log('成功添加 video_info 列到 download_status 表');
      }

      // 检查 download_status 表是否有常用字段列（如果缺少则添加）
      const commonFields = [
        { name: 'title', type: 'VARCHAR(512)' },
        { name: 'description', type: 'TEXT' },
        { name: 'author_nickname', type: 'VARCHAR(255)' },
        { name: 'author_unique_id', type: 'VARCHAR(255)' },
        { name: 'digg_count', type: 'INT DEFAULT 0' },
        { name: 'comment_count', type: 'INT DEFAULT 0' },
        { name: 'share_count', type: 'INT DEFAULT 0' },
        { name: 'collect_count', type: 'INT DEFAULT 0' },
        { name: 'create_time', type: 'BIGINT' },
        { name: 'duration', type: 'INT' },
        { name: 'video_width', type: 'INT' },
        { name: 'video_height', type: 'INT' },
        { name: 'music_title', type: 'VARCHAR(255)' },
        { name: 'music_author', type: 'VARCHAR(255)' },
        { name: 'poi_name', type: 'VARCHAR(255)' }
      ];

      for (const field of commonFields) {
        const [fieldColumns] = await this.pool.query(`SHOW COLUMNS FROM download_status LIKE '${field.name}'`);
        if (fieldColumns.length === 0) {
          console.log(`检测到 download_status 表缺少 ${field.name} 列，正在添加...`);
          await this.pool.query(`ALTER TABLE download_status ADD COLUMN ${field.name} ${field.type}`);
          console.log(`成功添加 ${field.name} 列到 download_status 表`);
        }
      }
    } catch (err) {
      console.error('检查/迁移数据库列失败:', err.message);
      // 不抛出错误，以免影响主流程
    }
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('数据库连接已关闭');
    }
  }

  /**
   * 从作品数据中提取常用字段
   */
  extractCommonFields(item) {
    if (!item) {
      return {};
    }
    
    return {
      title: item.share_info?.share_title || item.desc || null,
      description: item.desc || null,
      author_nickname: item.author?.nickname || null,
      author_unique_id: item.author?.unique_id || null,
      digg_count: item.statistics?.digg_count || 0,
      comment_count: item.statistics?.comment_count || 0,
      share_count: item.statistics?.share_count || 0,
      collect_count: item.statistics?.collect_count || 0,
      create_time: item.create_time || null,
      duration: item.duration || item.video?.duration || null,
      video_width: item.video?.width || null,
      video_height: item.video?.height || null,
      music_title: item.music?.title || null,
      music_author: item.music?.author || null,
      poi_name: item.poi_info?.poi_name || null
    };
  }

  /**
   * 保存作品信息
   */
  async saveItems(user, items) {
    const user_id = user.sec_user_id;
    const user_name = user.username;

    // 使用 INSERT IGNORE 或 ON DUPLICATE KEY UPDATE
    // 这里为了保持和 SQLite 的 INSERT OR IGNORE 一致的行为
    const sql = `
      INSERT IGNORE INTO download_status 
      (user_id, user_name, aweme_id, status, max_cursor,
       title, description, author_nickname, author_unique_id,
       digg_count, comment_count, share_count, collect_count,
       create_time, duration, video_width, video_height,
       music_title, music_author, poi_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 批量插入可能更高效，但为了保持简单循环逻辑
    for (const item of items) {
      const commonFields = this.extractCommonFields(item);
      
      await this.pool.execute(sql, [
        user_id,
        user_name,
        item.aweme_id,
        'pending',
        user.max_cursor,
        commonFields.title,
        commonFields.description,
        commonFields.author_nickname,
        commonFields.author_unique_id,
        commonFields.digg_count,
        commonFields.comment_count,
        commonFields.share_count,
        commonFields.collect_count,
        commonFields.create_time,
        commonFields.duration,
        commonFields.video_width,
        commonFields.video_height,
        commonFields.music_title,
        commonFields.music_author,
        commonFields.poi_name
      ]);
    }
  }

  /**
   * 获取待下载的作品ID列表
   */
  async getPendingItems(user_id) {
    const [rows] = await this.pool.execute(
      `SELECT aweme_id FROM download_status 
       WHERE user_id = ? AND status IN ('pending', 'failed') 
       ORDER BY created_at ASC`,
      [user_id]
    );
    return rows.map(row => row.aweme_id);
  }

  /**
   * 更新作品下载状态
   */
  async updateItemStatus(aweme_id, status, attempt_count = null) {
    const params = [status]; // updated_at 会自动更新如果定义了 ON UPDATE CURRENT_TIMESTAMP，但我们可以显式设置以防万一
    // MySQL CURRENT_TIMESTAMP 自动更新，但我们在SQL里显式写
    
    // 注意：MySQL update syntax
    let sql = `UPDATE download_status SET status = ?`; // updated_at will auto update or we set it
    
    if (attempt_count !== null) {
      sql += `, attempt_count = ?, last_attempt = NOW()`;
      params.push(attempt_count);
    }
    
    sql += ` WHERE aweme_id = ?`;
    params.push(aweme_id);

    await this.pool.execute(sql, params);
  }

  /**
   * 更新视频完整信息（包括video_info和常用字段）
   * @param {string} aweme_id - 视频ID
   * @param {object} item - 完整的作品数据对象
   */
  async updateVideoInfo(aweme_id, item) {
    if (!item) {
      return;
    }

    // 提取常用字段
    const commonFields = this.extractCommonFields(item);
    
    // 将完整JSON转换为字符串
    const videoInfoJson = JSON.stringify(item);
    
    // 构建更新SQL
    const updateFields = ['video_info = ?'];
    const updateValues = [videoInfoJson];
    
    const fieldMapping = {
      title: 'title',
      description: 'description',
      author_nickname: 'author_nickname',
      author_unique_id: 'author_unique_id',
      digg_count: 'digg_count',
      comment_count: 'comment_count',
      share_count: 'share_count',
      collect_count: 'collect_count',
      create_time: 'create_time',
      duration: 'duration',
      video_width: 'video_width',
      video_height: 'video_height',
      music_title: 'music_title',
      music_author: 'music_author',
      poi_name: 'poi_name'
    };
    
    for (const [key, column] of Object.entries(fieldMapping)) {
      if (commonFields.hasOwnProperty(key)) {
        updateFields.push(`${column} = ?`);
        updateValues.push(commonFields[key]);
      }
    }
    
    updateValues.push(aweme_id);
    
    await this.pool.execute(
      `UPDATE download_status SET ${updateFields.join(', ')} WHERE aweme_id = ?`,
      updateValues
    );
  }

  /**
   * 更新用户的最大游标
   */
  async updateUserCursor(user_id, max_cursor) {
    await this.pool.execute(
      `UPDATE download_status 
       SET max_cursor = ? 
       WHERE user_id = ?`,
      [max_cursor, user_id]
    );
  }

  /**
   * 检查作品是否已下载
   */
  async isItemDownloaded(user_id, aweme_id) {
    const [rows] = await this.pool.execute(
      `SELECT id FROM download_status 
       WHERE user_id = ? AND aweme_id = ? AND status = 'completed'`,
      [user_id, aweme_id]
    );
    return rows.length > 0;
  }

  /**
   * 根据aweme_id获取下载状态
   */
  async getDownloadStatus(aweme_id) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM download_status WHERE aweme_id = ?`,
      [aweme_id]
    );
    return rows[0] || null;
  }

  /**
   * 获取用户已下载的作品数量
   */
  async getDownloadedCount(user_id) {
    const [rows] = await this.pool.execute(
      `SELECT COUNT(*) as count FROM download_status 
       WHERE user_id = ? AND status = 'completed'`,
      [user_id]
    );
    return rows[0] ? rows[0].count : 0;
  }

  /**
   * 获取用户所有作品的状态统计
   */
  async getUserStats(user_id) {
    const [rows] = await this.pool.execute(
      `SELECT status, COUNT(*) as count FROM download_status 
       WHERE user_id = ? 
       GROUP BY status`,
      [user_id]
    );
    
    const stats = {};
    rows.forEach(row => {
      stats[row.status] = row.count;
    });
    return stats;
  }

  // ========== AI功能相关方法 ==========

  /**
   * 保存视频特征信息
   */
  async saveVideoFeatures(aweme_id, videoPath, aiFeatures, frameCount, mediaType = 'video') {
    const aiFeaturesJson = JSON.stringify(aiFeatures);
    // MySQL REPLACE INTO or INSERT ... ON DUPLICATE KEY UPDATE
    await this.pool.execute(
      `INSERT INTO video_features 
       (aweme_id, video_path, ai_features, frame_count, media_type, analyzed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
       video_path = VALUES(video_path),
       ai_features = VALUES(ai_features),
       frame_count = VALUES(frame_count),
       media_type = VALUES(media_type),
       analyzed_at = NOW(),
       updated_at = NOW()`,
      [aweme_id, videoPath, aiFeaturesJson, frameCount, mediaType]
    );
  }

  /**
   * 获取视频特征
   */
  async getVideoFeatures(aweme_id) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM video_features WHERE aweme_id = ?`,
      [aweme_id]
    );
    const row = rows[0];
    if (row && row.ai_features) {
      try {
        row.ai_features = JSON.parse(row.ai_features);
      } catch (e) {
        row.ai_features = {};
      }
    }
    return row;
  }

  /**
   * 保存视频帧信息
   */
  async saveVideoFrame(aweme_id, frameIndex, framePath, aiDescription) {
    await this.pool.execute(
      `INSERT INTO video_frames 
       (aweme_id, frame_index, frame_path, ai_description)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       frame_path = VALUES(frame_path),
       ai_description = VALUES(ai_description)`,
      [aweme_id, frameIndex, framePath, aiDescription]
    );
  }

  /**
   * 获取未分析的视频列表
   */
  async getUnanalyzedVideos(limit = 10) {
    const [rows] = await this.pool.execute(
      `SELECT DISTINCT ds.aweme_id, ds.user_id, ds.user_name, ds.created_at, ds.updated_at,
              ds.title, ds.description, ds.author_nickname, ds.author_unique_id,
              ds.digg_count, ds.comment_count, ds.share_count, ds.collect_count,
              ds.create_time, ds.duration, ds.video_width, ds.video_height,
              ds.music_title, ds.music_author, ds.poi_name,
              CASE WHEN vf.aweme_id IS NOT NULL THEN 1 ELSE 0 END as is_analyzed
       FROM download_status ds
       LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
       LEFT JOIN user_feedback uf ON ds.aweme_id = uf.aweme_id
       WHERE ds.status = 'completed' 
       AND (
         (vf.aweme_id IS NULL)
         OR
         (vf.aweme_id IS NOT NULL AND uf.aweme_id IS NULL)
       )
       ORDER BY is_analyzed DESC, RAND()
       LIMIT ?`,
      [limit] // RAND() instead of RANDOM()
    );
    return rows || [];
  }

  /**
   * 获取仅未分析的视频列表
   */
  async getUnanalyzedVideosForAnalysis(limit = 10) {
    const [rows] = await this.pool.execute(
      `SELECT DISTINCT ds.aweme_id, ds.user_id, ds.user_name, ds.created_at, ds.updated_at
       FROM download_status ds
       LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
       WHERE ds.status = 'completed' 
       AND vf.aweme_id IS NULL
       ORDER BY RAND()
       LIMIT ?`,
      [limit]
    );
    return rows || [];
  }

  /**
   * 获取分析统计信息
   */
  async getAnalysisStats() {
    const [totalRows] = await this.pool.execute(
      `SELECT COUNT(DISTINCT aweme_id) as total_downloaded
       FROM download_status
       WHERE status = 'completed'`
    );
    
    const [analyzedRows] = await this.pool.execute(
      `SELECT COUNT(DISTINCT vf.aweme_id) as total_analyzed
       FROM video_features vf
       INNER JOIN download_status ds ON vf.aweme_id = ds.aweme_id
       WHERE ds.status = 'completed'`
    );
    
    const [unanalyzedRows] = await this.pool.execute(
      `SELECT COUNT(DISTINCT ds.aweme_id) as total_unanalyzed
       FROM download_status ds
       LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
       WHERE ds.status = 'completed'
       AND vf.aweme_id IS NULL`
    );

    return {
      totalDownloaded: totalRows[0]?.total_downloaded || 0,
      totalAnalyzed: analyzedRows[0]?.total_analyzed || 0,
      totalUnanalyzed: unanalyzedRows[0]?.total_unanalyzed || 0
    };
  }

  /**
   * 获取视频的所有帧
   */
  async getVideoFrames(aweme_id) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM video_frames WHERE aweme_id = ? ORDER BY frame_index ASC`,
      [aweme_id]
    );
    return rows || [];
  }

  /**
   * 获取今日下载的视频列表
   */
  async getTodayDownloadedVideos(date) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const [rows] = await this.pool.execute(
      `SELECT ds.*, vf.ai_features, vf.video_path 
       FROM download_status ds
       LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
       WHERE DATE(ds.updated_at) = ?
       AND ds.status = 'completed'
       ORDER BY ds.updated_at DESC`,
      [dateStr]
    );
    
    rows.forEach(row => {
      if (row.ai_features) {
        try {
          row.ai_features = JSON.parse(row.ai_features);
        } catch (e) {
          row.ai_features = {};
        }
      }
    });
    return rows || [];
  }

  /**
   * 获取最新下载的视频列表
   */
  async getLatestDownloadedVideos(limit = 10) {
    const [rows] = await this.pool.execute(
      `SELECT ds.*, vf.ai_features, vf.video_path 
       FROM download_status ds
       LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
       WHERE ds.status = 'completed'
       ORDER BY ds.updated_at DESC
       LIMIT ?`,
      [limit]
    );
    
    rows.forEach(row => {
      if (row.ai_features) {
        try {
          row.ai_features = JSON.parse(row.ai_features);
        } catch (e) {
          row.ai_features = {};
        }
      }
    });
    return rows || [];
  }

  /**
   * 创建或更新每日总结
   */
  async saveDailySummary(date, summaryContent, videoCount, webuiToken) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    await this.pool.execute(
      `INSERT INTO daily_summaries 
       (summary_date, summary_content, video_count, webui_token, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       summary_content = VALUES(summary_content),
       video_count = VALUES(video_count),
       webui_token = VALUES(webui_token),
       updated_at = NOW()`,
      [dateStr, summaryContent, videoCount, webuiToken]
    );
  }

  /**
   * 获取每日总结
   */
  async getDailySummary(date) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const [rows] = await this.pool.execute(
      `SELECT * FROM daily_summaries WHERE summary_date = ?`,
      [dateStr]
    );
    return rows[0];
  }

  /**
   * 标记每日总结邮件已发送
   */
  async markDailySummaryEmailSent(date) {
    const dateStr = date || new Date().toISOString().split('T')[0];
    await this.pool.execute(
      `UPDATE daily_summaries SET email_sent = 1 WHERE summary_date = ?`,
      [dateStr]
    );
  }

  /**
   * 保存用户反馈
   */
  async saveUserFeedback(aweme_id, feedbackType, summaryId) {
    await this.pool.execute(
      `INSERT INTO user_feedback (aweme_id, feedback_type, summary_id)
       VALUES (?, ?, ?)`,
      [aweme_id, feedbackType, summaryId]
    );
  }

  /**
   * 获取用户反馈
   */
  async getUserFeedback(aweme_id) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM user_feedback WHERE aweme_id = ? ORDER BY created_at DESC`,
      [aweme_id]
    );
    return rows || [];
  }

  /**
   * 更新用户偏好分数
   */
  async updateUserPreference(featureKey, featureValue, scoreDelta) {
    // 先查找是否存在
    const [rows] = await this.pool.execute(
      `SELECT * FROM user_preferences WHERE feature_key = ? AND feature_value = ?`,
      [featureKey, featureValue]
    );
    const row = rows[0];

    if (row) {
      // 更新现有记录（加权平均）
      const newSampleCount = row.sample_count + 1;
      const currentScore = row.preference_score;
      const newScore = (currentScore * row.sample_count + scoreDelta) / newSampleCount;
      
      await this.pool.execute(
        `UPDATE user_preferences 
         SET preference_score = ?, sample_count = ?, updated_at = NOW()
         WHERE feature_key = ? AND feature_value = ?`,
        [newScore, newSampleCount, featureKey, featureValue]
      );
    } else {
      // 创建新记录
      await this.pool.execute(
        `INSERT INTO user_preferences (feature_key, feature_value, preference_score, sample_count)
         VALUES (?, ?, ?, 1)`,
        [featureKey, featureValue, scoreDelta]
      );
    }
  }

  /**
   * 获取所有用户偏好
   */
  async getUserPreferences() {
    const [rows] = await this.pool.execute(
      `SELECT * FROM user_preferences ORDER BY preference_score DESC, sample_count DESC`
    );
    return rows || [];
  }

  /**
   * 根据偏好计算视频推荐分数
   */
  async calculateVideoPreferenceScore(aweme_id) {
    try {
      const features = await this.getVideoFeatures(aweme_id);
      if (!features || !features.ai_features) {
        return 0;
      }

      const preferences = await this.getUserPreferences();
      if (preferences.length === 0) {
        return 0;
      }

      // 计算匹配分数
      let totalScore = 0;
      let matchCount = 0;
      const aiFeatures = features.ai_features;

      preferences.forEach(pref => {
        if (pref.preference_score > 0 && aiFeatures[pref.feature_key] === pref.feature_value) {
          totalScore += pref.preference_score * Math.log(pref.sample_count + 1);
          matchCount++;
        }
      });

      // 归一化分数
      const finalScore = matchCount > 0 ? totalScore / matchCount : 0;
      return finalScore;
    } catch (error) {
      console.error('计算推荐分数失败:', error);
      throw error;
    }
  }

  // ========== 下载任务相关方法 ==========

  /**
   * 创建下载任务
   * @param {string} jobId - 任务ID
   * @param {string} awemeId - 作品ID
   * @param {string} userId - 用户ID
   * @param {string} userName - 用户名
   * @param {string} downloadUrl - 下载URL
   */
  async createDownloadJob(jobId, awemeId, userId, userName, downloadUrl = null) {
    await this.pool.execute(
      `INSERT INTO download_jobs (job_id, aweme_id, user_id, user_name, status, download_url)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [jobId, awemeId, userId, userName, downloadUrl]
    );
  }

  /**
   * 获取下载任务
   * @param {string} jobId - 任务ID
   */
  async getDownloadJob(jobId) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM download_jobs WHERE job_id = ?`,
      [jobId]
    );
    return rows[0] || null;
  }

  /**
   * 更新下载任务状态
   * @param {string} jobId - 任务ID
   * @param {string} status - 状态 (pending, processing, completed, failed)
   * @param {string} downloadUrl - 下载直链（可选）
   * @param {string} errorMessage - 错误信息（可选）
   */
  async updateDownloadJobStatus(jobId, status, downloadUrl = null, errorMessage = null) {
    const updates = ['status = ?'];
    const params = [status];

    if (downloadUrl !== null) {
      updates.push('download_url = ?');
      params.push(downloadUrl);
    }

    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(jobId);

    await this.pool.execute(
      `UPDATE download_jobs SET ${updates.join(', ')}, updated_at = NOW() WHERE job_id = ?`,
      params
    );
  }

  /**
   * 获取待处理的下载任务
   */
  async getPendingDownloadJobs(limit = 10) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM download_jobs 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT ?`,
      [limit]
    );
    return rows || [];
  }

  // ========== 用户Token相关方法 ==========

  /**
   * 创建或更新用户token
   * @param {string} token - Token字符串
   * @param {string} userName - 用户名（可选）
   */
  async createOrUpdateUserToken(token, userName = null) {
    await this.pool.execute(
      `INSERT INTO user_tokens (token, user_name, last_download_timestamp)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE
       user_name = IFNULL(?, user_name),
       updated_at = NOW()`,
      [token, userName, userName]
    );
  }

  /**
   * 获取用户token信息
   * @param {string} token - Token字符串
   */
  async getUserToken(token) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM user_tokens WHERE token = ?`,
      [token]
    );
    return rows[0] || null;
  }

  /**
   * 更新用户最后下载时间戳
   * @param {string} token - Token字符串
   * @param {number} timestamp - 时间戳
   */
  async updateLastDownloadTimestamp(token, timestamp) {
    await this.pool.execute(
      `UPDATE user_tokens 
       SET last_download_timestamp = ?, updated_at = NOW()
       WHERE token = ?`,
      [timestamp, token]
    );
  }

  /**
   * 获取token用户需要下载的新视频（基于timestamp）
   * @param {string} token - Token字符串
   * @param {number} limit - 限制数量
   * @param {boolean} includeCompleted - 是否包含已完成的视频（默认false，只返回未下载的）
   */
  async getNewVideosForToken(token, limit = 100, includeCompleted = false) {
    const tokenInfo = await this.getUserToken(token);
    if (!tokenInfo) {
      return [];
    }

    const lastTimestamp = tokenInfo.last_download_timestamp || 0;

    let statusCondition = "ds.status = 'pending'";
    if (includeCompleted) {
      statusCondition = "ds.status IN ('pending', 'completed')";
    }

    const [rows] = await this.pool.execute(
      `SELECT ds.*, 
              CASE WHEN ds.video_info IS NOT NULL THEN 1 ELSE 0 END as has_video_info
       FROM download_status ds
       WHERE ds.create_time > ?
       AND ${statusCondition}
       ORDER BY ds.create_time ASC
       LIMIT ?`,
      [lastTimestamp, limit]
    );

    return rows || [];
  }

  // ========== 批量下载任务相关方法 ==========

  /**
   * 创建批量下载任务
   * @param {string} jobId - 任务ID
   * @param {string} token - Token
   * @param {array} awemeIds - 作品ID列表
   */
  async createBatchDownloadJob(jobId, token, awemeIds) {
    const awemeIdsJson = JSON.stringify(awemeIds);
    await this.pool.execute(
      `INSERT INTO batch_download_jobs (job_id, token, aweme_ids, total_count, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [jobId, token, awemeIdsJson, awemeIds.length]
    );
  }

  /**
   * 获取批量下载任务
   * @param {string} jobId - 任务ID
   */
  async getBatchDownloadJob(jobId) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM batch_download_jobs WHERE job_id = ?`,
      [jobId]
    );
    const row = rows[0];
    if (row && row.aweme_ids) {
      try {
        row.aweme_ids = JSON.parse(row.aweme_ids);
      } catch (e) {
        row.aweme_ids = [];
      }
    }
    if (row && row.download_urls) {
      try {
        row.download_urls = JSON.parse(row.download_urls);
      } catch (e) {
        row.download_urls = [];
      }
    }
    return row || null;
  }

  /**
   * 更新批量下载任务状态
   * @param {string} jobId - 任务ID
   * @param {string} status - 状态
   * @param {number} completedCount - 完成数量
   * @param {number} failedCount - 失败数量
   * @param {array} downloadUrls - 下载链接列表
   * @param {string} errorMessage - 错误信息
   */
  async updateBatchDownloadJobStatus(jobId, status, completedCount = null, failedCount = null, downloadUrls = null, errorMessage = null) {
    const updates = ['status = ?'];
    const params = [status];

    if (completedCount !== null) {
      updates.push('completed_count = ?');
      params.push(completedCount);
    }

    if (failedCount !== null) {
      updates.push('failed_count = ?');
      params.push(failedCount);
    }

    if (downloadUrls !== null) {
      updates.push('download_urls = ?');
      params.push(JSON.stringify(downloadUrls));
    }

    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(jobId);

    await this.pool.execute(
      `UPDATE batch_download_jobs SET ${updates.join(', ')}, updated_at = NOW() WHERE job_id = ?`,
      params
    );
  }

  /**
   * 获取待处理的批量下载任务
   */
  async getPendingBatchDownloadJobs(limit = 5) {
    const [rows] = await this.pool.execute(
      `SELECT * FROM batch_download_jobs 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT ?`,
      [limit]
    );
    
    // 解析JSON字段
    rows.forEach(row => {
      if (row.aweme_ids) {
        try {
          row.aweme_ids = JSON.parse(row.aweme_ids);
        } catch (e) {
          row.aweme_ids = [];
        }
      }
    });
    
    return rows || [];
  }
}

module.exports = new MySQLDatabase();

