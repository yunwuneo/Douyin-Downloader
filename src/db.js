const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { ensureDirectory } = require('./utils');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/download_status.db');
    this.db = null;
  }

  /**
   * 初始化数据库连接
   */
  async init() {
    // 确保数据目录存在
    await ensureDirectory(path.dirname(this.dbPath));
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) {
          console.error('连接数据库失败:', err.message);
          reject(err);
          return;
        }
        console.log('数据库连接成功');
        
        // 创建表
        try {
          await this.createTables();
          console.log('数据库表创建成功');
          // 执行数据库迁移
          await this.checkAndAddColumns();
          resolve();
        } catch (createErr) {
          console.error('创建数据库表失败:', createErr.message);
          reject(createErr);
        }
      });
    });
  }

  /**
   * 创建数据库表
   */
  createTables() {
    return new Promise((resolve, reject) => {
      // 创建下载状态表
      this.db.serialize(() => {
        // 开始事务
        this.db.run('BEGIN TRANSACTION');
        
        // 创建下载状态表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS download_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            user_name TEXT NOT NULL,
            aweme_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',  -- pending, downloading, completed, failed
            max_cursor INTEGER DEFAULT 0,
            attempt_count INTEGER DEFAULT 0,
            last_attempt TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, aweme_id)
          )`,
          (err) => {
            if (err) {
              console.error('创建表失败:', err.message);
              this.db.run('ROLLBACK');
              reject(err);
              return;
            }
          }
        );

        // 创建视频特征表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS video_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aweme_id TEXT NOT NULL UNIQUE,
            video_path TEXT,
            description TEXT,
            ai_features TEXT,  -- JSON格式存储AI提取的特征
            frame_count INTEGER DEFAULT 0,
            media_type TEXT DEFAULT 'video',  -- 'video' 或 'image'
            analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          (err) => {
            if (err) {
              console.error('创建video_features表失败:', err.message);
            }
          }
        );

        // 创建视频帧表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS video_frames (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aweme_id TEXT NOT NULL,
            frame_index INTEGER NOT NULL,
            frame_path TEXT NOT NULL,
            ai_description TEXT,  -- AI对帧的描述
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(aweme_id, frame_index)
          )`,
          (err) => {
            if (err) {
              console.error('创建video_frames表失败:', err.message);
            }
          }
        );

        // 创建用户偏好表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature_key TEXT NOT NULL,  -- 特征键（如：场景类型、颜色、风格等）
            feature_value TEXT NOT NULL,  -- 特征值
            preference_score REAL DEFAULT 0.0,  -- 偏好分数 (-1.0 到 1.0)
            sample_count INTEGER DEFAULT 0,  -- 样本数量
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(feature_key, feature_value)
          )`,
          (err) => {
            if (err) {
              console.error('创建user_preferences表失败:', err.message);
            }
          }
        );

        // 创建用户反馈表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS user_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aweme_id TEXT NOT NULL,
            feedback_type TEXT NOT NULL,  -- 'like' 或 'dislike'
            summary_id TEXT,  -- 关联的每日总结ID
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          (err) => {
            if (err) {
              console.error('创建user_feedback表失败:', err.message);
            }
          }
        );

        // 创建每日总结表
        this.db.run(
          `CREATE TABLE IF NOT EXISTS daily_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summary_date TEXT NOT NULL UNIQUE,  -- 日期，格式: YYYY-MM-DD
            summary_content TEXT,  -- 总结内容（HTML格式）
            video_count INTEGER DEFAULT 0,
            email_sent INTEGER DEFAULT 0,  -- 0=未发送, 1=已发送
            webui_token TEXT,  -- Web UI访问token
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          (err) => {
            if (err) {
              console.error('创建daily_summaries表失败:', err.message);
            }
          }
        );

        // 创建索引
        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_user_id ON download_status(user_id)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );
        
        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_aweme_id ON download_status(aweme_id)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );
        
        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_status ON download_status(status)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );

        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_video_features_aweme_id ON video_features(aweme_id)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );

        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_user_feedback_aweme_id ON user_feedback(aweme_id)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );

        this.db.run(
          'CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(summary_date)',
          (err) => {
            if (err) {
              console.error('创建索引失败:', err.message);
            }
          }
        );
        
        // 提交事务
        this.db.run('COMMIT', (err) => {
          if (err) {
            console.error('提交事务失败:', err.message);
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }

  /**
   * 检查并添加缺失的列（数据库迁移）
   */
  checkAndAddColumns() {
    return new Promise((resolve, reject) => {
      // 检查 video_features 表是否有 media_type 列
      this.db.all("PRAGMA table_info(video_features)", (err, columns) => {
        if (err) {
          // 如果表不存在，忽略错误（会在 createTables 中创建）
          console.log('检查 video_features 表结构:', err.message);
          resolve();
          return;
        }
        
        const hasMediaType = columns.some(col => col.name === 'media_type');
        if (!hasMediaType) {
          console.log('检测到 video_features 表缺少 media_type 列，正在添加...');
          this.db.run(
            "ALTER TABLE video_features ADD COLUMN media_type TEXT DEFAULT 'video'",
            (alterErr) => {
              if (alterErr) {
                console.error('添加 media_type 列失败:', alterErr.message);
                reject(alterErr);
                return;
              } else {
                console.log('成功添加 media_type 列到 video_features 表');
                resolve();
              }
            }
          );
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('数据库连接已关闭');
    }
  }

  /**
   * 保存作品信息
   */
  async saveItems(user, items) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO download_status 
         (user_id, user_name, aweme_id, status, max_cursor)
         VALUES (?, ?, ?, ?, ?)`
      );

      const user_id = user.sec_user_id;
      const user_name = user.username;

      for (const item of items) {
        stmt.run(
          user_id,
          user_name,
          item.aweme_id,
          'pending',
          user.max_cursor
        );
      }

      stmt.finalize((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 获取待下载的作品ID列表
   */
  async getPendingItems(user_id) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT aweme_id FROM download_status 
         WHERE user_id = ? AND status IN ('pending', 'failed') 
         ORDER BY created_at ASC`,
        [user_id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows.map(row => row.aweme_id));
        }
      );
    });
  }

  /**
   * 更新作品下载状态
   */
  async updateItemStatus(aweme_id, status, attempt_count = null) {
    return new Promise((resolve, reject) => {
      const params = [status, new Date().toISOString()];
      let sql = `UPDATE download_status SET status = ?, updated_at = ?`;
      
      if (attempt_count !== null) {
        sql += `, attempt_count = ?, last_attempt = ?`;
        params.push(attempt_count, new Date().toISOString());
      }
      
      sql += ` WHERE aweme_id = ?`;
      params.push(aweme_id);

      this.db.run(sql, params, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 更新用户的最大游标
   */
  async updateUserCursor(user_id, max_cursor) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE download_status 
         SET max_cursor = ? 
         WHERE user_id = ?`,
        [max_cursor, user_id],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 检查作品是否已下载
   */
  async isItemDownloaded(user_id, aweme_id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT id FROM download_status 
         WHERE user_id = ? AND aweme_id = ? AND status = 'completed'`,
        [user_id, aweme_id],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(!!row);
        }
      );
    });
  }

  /**
   * 根据aweme_id获取下载状态
   */
  async getDownloadStatus(aweme_id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM download_status WHERE aweme_id = ?`,
        [aweme_id],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  /**
   * 获取用户已下载的作品数量
   */
  async getDownloadedCount(user_id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM download_status 
         WHERE user_id = ? AND status = 'completed'`,
        [user_id],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row ? row.count : 0);
        }
      );
    });
  }

  /**
   * 获取用户所有作品的状态统计
   */
  async getUserStats(user_id) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT status, COUNT(*) as count FROM download_status 
         WHERE user_id = ? 
         GROUP BY status`,
        [user_id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          
          const stats = {};
          rows.forEach(row => {
            stats[row.status] = row.count;
          });
          
          resolve(stats);
        }
      );
    });
  }

  // ========== AI功能相关方法 ==========

  /**
   * 保存视频特征信息
   */
  async saveVideoFeatures(aweme_id, videoPath, aiFeatures, frameCount, mediaType = 'video') {
    return new Promise((resolve, reject) => {
      const aiFeaturesJson = JSON.stringify(aiFeatures);
      this.db.run(
        `INSERT OR REPLACE INTO video_features 
         (aweme_id, video_path, ai_features, frame_count, media_type, analyzed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [aweme_id, videoPath, aiFeaturesJson, frameCount, mediaType],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 获取视频特征
   */
  async getVideoFeatures(aweme_id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM video_features WHERE aweme_id = ?`,
        [aweme_id],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (row && row.ai_features) {
            try {
              row.ai_features = JSON.parse(row.ai_features);
            } catch (e) {
              row.ai_features = {};
            }
          }
          resolve(row);
        }
      );
    });
  }

  /**
   * 保存视频帧信息
   */
  async saveVideoFrame(aweme_id, frameIndex, framePath, aiDescription) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO video_frames 
         (aweme_id, frame_index, frame_path, ai_description)
         VALUES (?, ?, ?, ?)`,
        [aweme_id, frameIndex, framePath, aiDescription],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 获取未分析的视频列表（已下载但未分析）或已分析但未标记喜好的视频
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 未分析的视频列表，包含已分析但未标记喜好的视频
   * 优先返回已分析但未标记喜好的视频，以节省用户判断时间
   */
  async getUnanalyzedVideos(limit = 10) {
    return new Promise((resolve, reject) => {
      // 查询已下载但未分析的视频，或者已分析但未标记喜好的视频
      // 未分析：video_features表中没有记录
      // 已分析但未标记喜好：video_features表中有记录，但user_feedback表中没有该aweme_id的记录
      // 优先展示已分析但未标记喜好的视频（is_analyzed DESC），以节省用户判断时间
      this.db.all(
        `SELECT DISTINCT ds.aweme_id, ds.user_id, ds.user_name, ds.created_at, ds.updated_at,
                CASE WHEN vf.aweme_id IS NOT NULL THEN 1 ELSE 0 END as is_analyzed
         FROM download_status ds
         LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
         LEFT JOIN user_feedback uf ON ds.aweme_id = uf.aweme_id
         WHERE ds.status = 'completed' 
         AND (
           -- 未分析的视频
           (vf.aweme_id IS NULL)
           OR
           -- 已分析但未标记喜好的视频
           (vf.aweme_id IS NOT NULL AND uf.aweme_id IS NULL)
         )
         ORDER BY is_analyzed DESC, RANDOM()
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 获取仅未分析的视频列表（用于AI分析任务）
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 未分析的视频列表
   */
  async getUnanalyzedVideosForAnalysis(limit = 10) {
    return new Promise((resolve, reject) => {
      // 只查询已下载但未分析的视频（video_features表中没有记录）
      this.db.all(
        `SELECT DISTINCT ds.aweme_id, ds.user_id, ds.user_name, ds.created_at, ds.updated_at
         FROM download_status ds
         LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
         WHERE ds.status = 'completed' 
         AND vf.aweme_id IS NULL
         ORDER BY RANDOM()
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 获取分析统计信息
   * @returns {Promise<Object>} 统计信息对象
   */
  async getAnalysisStats() {
    return new Promise((resolve, reject) => {
      // 查询所有已下载的作品总数
      this.db.get(
        `SELECT COUNT(DISTINCT aweme_id) as total_downloaded
         FROM download_status
         WHERE status = 'completed'`,
        [],
        (err, totalRow) => {
          if (err) {
            reject(err);
            return;
          }

          // 查询已分析的作品数
          this.db.get(
            `SELECT COUNT(DISTINCT vf.aweme_id) as total_analyzed
             FROM video_features vf
             INNER JOIN download_status ds ON vf.aweme_id = ds.aweme_id
             WHERE ds.status = 'completed'`,
            [],
            (err, analyzedRow) => {
              if (err) {
                reject(err);
                return;
              }

              // 查询未分析的作品数
              this.db.get(
                `SELECT COUNT(DISTINCT ds.aweme_id) as total_unanalyzed
                 FROM download_status ds
                 LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
                 WHERE ds.status = 'completed'
                 AND vf.aweme_id IS NULL`,
                [],
                (err, unanalyzedRow) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  resolve({
                    totalDownloaded: totalRow?.total_downloaded || 0,
                    totalAnalyzed: analyzedRow?.total_analyzed || 0,
                    totalUnanalyzed: unanalyzedRow?.total_unanalyzed || 0
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  /**
   * 获取视频的所有帧
   */
  async getVideoFrames(aweme_id) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM video_frames WHERE aweme_id = ? ORDER BY frame_index ASC`,
        [aweme_id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 获取今日下载的视频列表（用于每日总结）
   */
  async getTodayDownloadedVideos(date) {
    return new Promise((resolve, reject) => {
      const dateStr = date || new Date().toISOString().split('T')[0];
      this.db.all(
        `SELECT ds.*, vf.ai_features, vf.video_path 
         FROM download_status ds
         LEFT JOIN video_features vf ON ds.aweme_id = vf.aweme_id
         WHERE date(ds.updated_at) = date(?)
         AND ds.status = 'completed'
         ORDER BY ds.updated_at DESC`,
        [dateStr],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          // 解析JSON字段
          rows.forEach(row => {
            if (row.ai_features) {
              try {
                row.ai_features = JSON.parse(row.ai_features);
              } catch (e) {
                row.ai_features = {};
              }
            }
          });
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 创建或更新每日总结
   */
  async saveDailySummary(date, summaryContent, videoCount, webuiToken) {
    return new Promise((resolve, reject) => {
      const dateStr = date || new Date().toISOString().split('T')[0];
      this.db.run(
        `INSERT OR REPLACE INTO daily_summaries 
         (summary_date, summary_content, video_count, webui_token, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [dateStr, summaryContent, videoCount, webuiToken],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 获取每日总结
   */
  async getDailySummary(date) {
    return new Promise((resolve, reject) => {
      const dateStr = date || new Date().toISOString().split('T')[0];
      this.db.get(
        `SELECT * FROM daily_summaries WHERE summary_date = ?`,
        [dateStr],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row);
        }
      );
    });
  }

  /**
   * 标记每日总结邮件已发送
   */
  async markDailySummaryEmailSent(date) {
    return new Promise((resolve, reject) => {
      const dateStr = date || new Date().toISOString().split('T')[0];
      this.db.run(
        `UPDATE daily_summaries SET email_sent = 1 WHERE summary_date = ?`,
        [dateStr],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 保存用户反馈
   */
  async saveUserFeedback(aweme_id, feedbackType, summaryId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_feedback (aweme_id, feedback_type, summary_id)
         VALUES (?, ?, ?)`,
        [aweme_id, feedbackType, summaryId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 获取用户反馈
   */
  async getUserFeedback(aweme_id) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_feedback WHERE aweme_id = ? ORDER BY created_at DESC`,
        [aweme_id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 更新用户偏好分数
   */
  async updateUserPreference(featureKey, featureValue, scoreDelta) {
    return new Promise((resolve, reject) => {
      // 先查找是否存在
      this.db.get(
        `SELECT * FROM user_preferences WHERE feature_key = ? AND feature_value = ?`,
        [featureKey, featureValue],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            // 更新现有记录（加权平均）
            const newSampleCount = row.sample_count + 1;
            const currentScore = row.preference_score;
            // 使用加权平均更新分数
            const newScore = (currentScore * row.sample_count + scoreDelta) / newSampleCount;
            
            this.db.run(
              `UPDATE user_preferences 
               SET preference_score = ?, sample_count = ?, updated_at = CURRENT_TIMESTAMP
               WHERE feature_key = ? AND feature_value = ?`,
              [newScore, newSampleCount, featureKey, featureValue],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }
                resolve();
              }
            );
          } else {
            // 创建新记录
            this.db.run(
              `INSERT INTO user_preferences (feature_key, feature_value, preference_score, sample_count)
               VALUES (?, ?, ?, 1)`,
              [featureKey, featureValue, scoreDelta],
              (err) => {
                if (err) {
                  reject(err);
                  return;
                }
                resolve();
              }
            );
          }
        }
      );
    });
  }

  /**
   * 获取所有用户偏好
   */
  async getUserPreferences() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_preferences ORDER BY preference_score DESC, sample_count DESC`,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * 根据偏好计算视频推荐分数
   */
  async calculateVideoPreferenceScore(aweme_id) {
    return new Promise(async (resolve, reject) => {
      try {
        const features = await this.getVideoFeatures(aweme_id);
        if (!features || !features.ai_features) {
          resolve(0);
          return;
        }

        const preferences = await this.getUserPreferences();
        if (preferences.length === 0) {
          resolve(0);
          return;
        }

        // 计算匹配分数
        let totalScore = 0;
        let matchCount = 0;
        const aiFeatures = features.ai_features;

        preferences.forEach(pref => {
          if (pref.preference_score > 0 && aiFeatures[pref.feature_key] === pref.feature_value) {
            totalScore += pref.preference_score * Math.log(pref.sample_count + 1); // 使用对数加权
            matchCount++;
          }
        });

        // 归一化分数
        const finalScore = matchCount > 0 ? totalScore / matchCount : 0;
        resolve(finalScore);
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new Database();