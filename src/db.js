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
        
        // 创建表
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
   * 创建数据库表
   */
  createTables() {
    // 创建下载状态表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS download_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        aweme_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',  -- pending, downloading, completed, failed
        max_cursor INTEGER DEFAULT 0,
        attempt_count INTEGER DEFAULT 0,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, aweme_id)
      );
    `);

    // 创建索引
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_id ON download_status(user_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_aweme_id ON download_status(aweme_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_status ON download_status(status)`);
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
}

module.exports = new Database();