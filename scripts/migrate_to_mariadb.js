const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const mysqlDB = require('../src/db_mysql');
require('dotenv').config();

const SQLITE_DB_PATH = path.join(__dirname, '../data/download_status.db');

async function migrate() {
  console.log('========== 开始数据库迁移 (SQLite -> MariaDB) ==========');
  
  // 1. 连接 SQLite
  console.log(`正在读取 SQLite 数据库: ${SQLITE_DB_PATH}`);
  const sqliteDB = new sqlite3.Database(SQLITE_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error('无法打开 SQLite 数据库:', err.message);
      process.exit(1);
    }
  });

  // 2. 连接 MySQL/MariaDB
  console.log('正在连接 MySQL/MariaDB...');
  try {
    await mysqlDB.init();
  } catch (err) {
    console.error('MySQL 连接失败，请检查 .env 配置:', err.message);
    process.exit(1);
  }

  try {
    // 3. 迁移数据
    await migrateTable(sqliteDB, 'download_status', 
      'INSERT IGNORE INTO download_status (id, user_id, user_name, aweme_id, status, max_cursor, attempt_count, last_attempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['id', 'user_id', 'user_name', 'aweme_id', 'status', 'max_cursor', 'attempt_count', 'last_attempt', 'created_at', 'updated_at']
    );

    await migrateTable(sqliteDB, 'video_features',
      'INSERT IGNORE INTO video_features (id, aweme_id, video_path, description, ai_features, frame_count, media_type, analyzed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['id', 'aweme_id', 'video_path', 'description', 'ai_features', 'frame_count', 'media_type', 'analyzed_at', 'created_at', 'updated_at']
    );

    await migrateTable(sqliteDB, 'video_frames',
      'INSERT IGNORE INTO video_frames (id, aweme_id, frame_index, frame_path, ai_description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['id', 'aweme_id', 'frame_index', 'frame_path', 'ai_description', 'created_at']
    );

    await migrateTable(sqliteDB, 'user_preferences',
      'INSERT IGNORE INTO user_preferences (id, feature_key, feature_value, preference_score, sample_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['id', 'feature_key', 'feature_value', 'preference_score', 'sample_count', 'created_at', 'updated_at']
    );

    await migrateTable(sqliteDB, 'user_feedback',
      'INSERT IGNORE INTO user_feedback (id, aweme_id, feedback_type, summary_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['id', 'aweme_id', 'feedback_type', 'summary_id', 'created_at']
    );

    await migrateTable(sqliteDB, 'daily_summaries',
      'INSERT IGNORE INTO daily_summaries (id, summary_date, summary_content, video_count, email_sent, webui_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['id', 'summary_date', 'summary_content', 'video_count', 'email_sent', 'webui_token', 'created_at', 'updated_at']
    );

    console.log('\n========== 迁移完成 ==========');
    console.log('请更新 .env 文件设置 DB_TYPE=mysql 以启用新数据库');

  } catch (err) {
    console.error('\n迁移过程中出错:', err);
  } finally {
    sqliteDB.close();
    await mysqlDB.close();
  }
}

function migrateTable(sqliteDB, tableName, insertSql, columns) {
  return new Promise((resolve, reject) => {
    console.log(`\n正在迁移表 ${tableName}...`);
    
    sqliteDB.all(`SELECT * FROM ${tableName}`, async (err, rows) => {
      if (err) {
        // 如果表不存在，可能是正常的（如新功能表）
        if (err.message.includes('no such table')) {
          console.log(`SQLite 中未找到表 ${tableName}，跳过`);
          resolve();
          return;
        }
        reject(err);
        return;
      }

      console.log(`找到 ${rows.length} 条记录`);
      if (rows.length === 0) {
        resolve();
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      // 批量处理，每批 100 条
      const BATCH_SIZE = 100;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        
        // 并行执行当前批次
        const promises = batch.map(async (row) => {
          const params = columns.map(col => row[col]);
          try {
            await mysqlDB.pool.execute(insertSql, params);
            successCount++;
          } catch (insertErr) {
            errorCount++;
            console.error(`插入失败 (ID: ${row.id}):`, insertErr.message);
          }
        });

        await Promise.all(promises);
        process.stdout.write(`\r进度: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
      }

      console.log(`\n表 ${tableName} 迁移完成: 成功 ${successCount}, 失败 ${errorCount}`);
      resolve();
    });
  });
}

migrate();

