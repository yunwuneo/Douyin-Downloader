const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

class VectorStore {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/vectors.sqlite');
    this.db = null;
  }

  async init() {
    await fs.ensureDir(path.dirname(this.dbPath));
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('无法连接到向量数据库:', err.message);
          reject(err);
        } else {
          console.log('已连接到向量数据库');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const createVectorsTable = `
      CREATE TABLE IF NOT EXISTS video_vectors (
        aweme_id TEXT PRIMARY KEY,
        vector TEXT NOT NULL, -- JSON string of the vector array
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createUserProfileTable = `
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createVectorsTable);
        this.db.run(createUserProfileTable, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  /**
   * 保存视频向量
   * @param {string} awemeId 
   * @param {Array<number>} vector 
   * @param {string} description 
   */
  async saveVector(awemeId, vector, description) {
    if (!this.db) await this.init();
    
    const sql = `
      INSERT OR REPLACE INTO video_vectors (aweme_id, vector, description, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `;
    
    return new Promise((resolve, reject) => {
      this.db.run(sql, [awemeId, JSON.stringify(vector), description], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取视频向量
   * @param {string} awemeId 
   */
  async getVector(awemeId) {
    if (!this.db) await this.init();
    
    const sql = `SELECT vector FROM video_vectors WHERE aweme_id = ?`;
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, [awemeId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? JSON.parse(row.vector) : null);
      });
    });
  }

  /**
   * 获取所有视频向量（用于计算相似度）
   */
  async getAllVectors() {
    if (!this.db) await this.init();
    
    const sql = `SELECT aweme_id, vector FROM video_vectors`;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, [], (err, rows) => {
        if (err) reject(err);
        else {
          const results = rows.map(row => ({
            aweme_id: row.aweme_id,
            vector: JSON.parse(row.vector)
          }));
          resolve(results);
        }
      });
    });
  }

  /**
   * 获取指定ID列表的向量
   * @param {Array<string>} awemeIds 
   */
  async getVectorsByIds(awemeIds) {
    if (!awemeIds || awemeIds.length === 0) return [];
    if (!this.db) await this.init();
    
    const placeholders = awemeIds.map(() => '?').join(',');
    const sql = `SELECT aweme_id, vector FROM video_vectors WHERE aweme_id IN (${placeholders})`;
    
    return new Promise((resolve, reject) => {
      this.db.all(sql, awemeIds, (err, rows) => {
        if (err) reject(err);
        else {
          const results = rows.map(row => ({
            aweme_id: row.aweme_id,
            vector: JSON.parse(row.vector)
          }));
          resolve(results);
        }
      });
    });
  }
  
  /**
   * 更新用户偏好向量
   * @param {Array<number>} newVector - 新喜欢的视频向量
   * @param {string} userId - 用户ID (默认 'default')
   */
  async updateUserProfile(newVector, userId = 'default') {
    if (!this.db) await this.init();
    
    // 获取当前画像
    const sqlGet = `SELECT vector, count FROM user_profiles WHERE user_id = ?`;
    
    return new Promise((resolve, reject) => {
      this.db.get(sqlGet, [userId], (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        let currentVector = null;
        let count = 0;

        if (row) {
          currentVector = JSON.parse(row.vector);
          count = row.count;
        }

        // 计算新向量 (加权平均)
        let updatedVector;
        if (!currentVector) {
          updatedVector = newVector;
          count = 1;
        } else {
          updatedVector = currentVector.map((val, idx) => {
            return (val * count + newVector[idx]) / (count + 1);
          });
          count += 1;
        }

        const sqlUpdate = `
          INSERT OR REPLACE INTO user_profiles (user_id, vector, count, updated_at)
          VALUES (?, ?, ?, datetime('now'))
        `;

        this.db.run(sqlUpdate, [userId, JSON.stringify(updatedVector), count], (err) => {
          if (err) reject(err);
          else resolve(updatedVector);
        });
      });
    });
  }

  /**
   * 获取用户偏好向量
   * @param {string} userId 
   */
  async getUserProfileVector(userId = 'default') {
    if (!this.db) await this.init();
    
    const sql = `SELECT vector FROM user_profiles WHERE user_id = ?`;
    
    return new Promise((resolve, reject) => {
      this.db.get(sql, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? JSON.parse(row.vector) : null);
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = new VectorStore();

