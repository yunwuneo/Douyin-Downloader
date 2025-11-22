#!/usr/bin/env node

/**
 * 将已下载视频的JSON文件信息更新到数据库
 * 
 * 使用方法:
 *   node scripts/update-video-info-from-json.js
 *   node scripts/update-video-info-from-json.js --force  # 强制更新所有记录（包括已有数据的）
 * 
 * 功能:
 *   1. 检查并添加以下字段到download_status表（如果不存在）:
 *      - video_info: 完整的JSON信息（LONGTEXT/TEXT）
 *      - title: 视频标题（从share_info.share_title提取）
 *      - description: 视频描述（从desc提取）
 *      - author_nickname: 作者昵称
 *      - author_unique_id: 作者唯一ID
 *      - digg_count: 点赞数
 *      - comment_count: 评论数
 *      - share_count: 分享数
 *      - collect_count: 收藏数
 *      - create_time: 创建时间戳
 *      - duration: 视频时长（毫秒）
 *      - video_width: 视频宽度
 *      - video_height: 视频高度
 *      - music_title: 音乐标题
 *      - music_author: 音乐作者
 *      - poi_name: 位置名称
 *   2. 遍历所有已完成的视频记录
 *   3. 根据user_name和aweme_id找到对应的JSON文件
 *   4. 读取JSON内容并更新到数据库（包括完整JSON和常用字段）
 * 
 * 参数:
 *   --force, -f: 强制更新模式，即使记录已有video_info也会更新
 */

const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const db = require('../src/db');
const { readJSON } = require('../src/utils');

// 配置
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || './downloads';

/**
 * 检查并添加video_info字段和常用字段到数据库表
 */
async function ensureVideoInfoColumn() {
  try {
    const dbType = process.env.DB_TYPE || (process.env.DB_HOST ? 'mysql' : 'sqlite');
    
    // 需要添加的字段列表
    const columnsToAdd = [
      { name: 'video_info', mysql: 'LONGTEXT DEFAULT NULL COMMENT \'视频完整信息JSON\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'title', mysql: 'VARCHAR(500) DEFAULT NULL COMMENT \'视频标题\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'description', mysql: 'TEXT DEFAULT NULL COMMENT \'视频描述\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'author_nickname', mysql: 'VARCHAR(255) DEFAULT NULL COMMENT \'作者昵称\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'author_unique_id', mysql: 'VARCHAR(64) DEFAULT NULL COMMENT \'作者唯一ID\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'digg_count', mysql: 'BIGINT DEFAULT 0 COMMENT \'点赞数\'', sqlite: 'INTEGER DEFAULT 0' },
      { name: 'comment_count', mysql: 'BIGINT DEFAULT 0 COMMENT \'评论数\'', sqlite: 'INTEGER DEFAULT 0' },
      { name: 'share_count', mysql: 'BIGINT DEFAULT 0 COMMENT \'分享数\'', sqlite: 'INTEGER DEFAULT 0' },
      { name: 'collect_count', mysql: 'BIGINT DEFAULT 0 COMMENT \'收藏数\'', sqlite: 'INTEGER DEFAULT 0' },
      { name: 'create_time', mysql: 'BIGINT DEFAULT NULL COMMENT \'创建时间戳\'', sqlite: 'INTEGER DEFAULT NULL' },
      { name: 'duration', mysql: 'INT DEFAULT NULL COMMENT \'视频时长(毫秒)\'', sqlite: 'INTEGER DEFAULT NULL' },
      { name: 'video_width', mysql: 'INT DEFAULT NULL COMMENT \'视频宽度\'', sqlite: 'INTEGER DEFAULT NULL' },
      { name: 'video_height', mysql: 'INT DEFAULT NULL COMMENT \'视频高度\'', sqlite: 'INTEGER DEFAULT NULL' },
      { name: 'music_title', mysql: 'VARCHAR(500) DEFAULT NULL COMMENT \'音乐标题\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'music_author', mysql: 'VARCHAR(255) DEFAULT NULL COMMENT \'音乐作者\'', sqlite: 'TEXT DEFAULT NULL' },
      { name: 'poi_name', mysql: 'VARCHAR(255) DEFAULT NULL COMMENT \'位置名称\'', sqlite: 'TEXT DEFAULT NULL' }
    ];
    
    if (dbType === 'mysql' || dbType === 'mariadb') {
      // MySQL/MariaDB
      const mysql = require('mysql2/promise');
      const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'douyin_downloader'
      };
      
      const connection = await mysql.createConnection(config);
      
      // 检查并添加每个字段
      for (const column of columnsToAdd) {
        const [columns] = await connection.query(
          `SHOW COLUMNS FROM download_status LIKE '${column.name}'`
        );
        
        if (columns.length === 0) {
          console.log(`检测到download_status表缺少${column.name}列，正在添加...`);
          await connection.query(
            `ALTER TABLE download_status ADD COLUMN ${column.name} ${column.mysql}`
          );
          console.log(`成功添加${column.name}列到download_status表`);
        }
      }
      
      await connection.end();
    } else {
      // SQLite
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, '..', 'data', 'download_status.db');
      
      return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          // 获取现有字段列表
          database.all("PRAGMA table_info(download_status)", (err, rows) => {
            if (err) {
              database.close();
              reject(err);
              return;
            }
            
            const existingColumns = rows.map(row => row.name);
            const columnsToAddList = columnsToAdd.filter(col => !existingColumns.includes(col.name));
            
            if (columnsToAddList.length === 0) {
              console.log('所有字段已存在，跳过添加');
              database.close();
              resolve();
              return;
            }
            
            let completedCount = 0;
            
            // 添加缺失的字段
            for (const column of columnsToAddList) {
              console.log(`检测到download_status表缺少${column.name}列，正在添加...`);
              database.run(
                `ALTER TABLE download_status ADD COLUMN ${column.name} ${column.sqlite}`,
                (err) => {
                  if (err) {
                    console.error(`添加${column.name}列失败:`, err.message);
                  } else {
                    console.log(`成功添加${column.name}列到download_status表`);
                  }
                  completedCount++;
                  if (completedCount === columnsToAddList.length) {
                    database.close();
                    resolve();
                  }
                }
              );
            }
          });
        });
      });
    }
  } catch (error) {
    console.error('检查/添加video_info列失败:', error.message);
    throw error;
  }
}

/**
 * 在指定目录下查找包含指定aweme_id的JSON文件
 * @param {string} userDir - 用户目录路径
 * @param {string} awemeId - 视频ID
 * @returns {string|null} JSON文件路径，如果未找到则返回null
 */
async function findJsonFileByAwemeId(userDir, awemeId) {
  try {
    const videosDir = path.join(userDir, 'videos');
    const photosDir = path.join(userDir, 'photos');
    
    // 检查videos目录
    if (await fs.pathExists(videosDir)) {
      const files = await fs.readdir(videosDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(videosDir, jsonFile);
        try {
          const jsonData = await readJSON(jsonPath);
          if (jsonData && jsonData.aweme_id === awemeId) {
            return jsonPath;
          }
        } catch (error) {
          // 忽略读取失败的JSON文件
          continue;
        }
      }
    }
    
    // 检查photos目录（图片作品也可能有JSON文件）
    if (await fs.pathExists(photosDir)) {
      const files = await fs.readdir(photosDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(photosDir, jsonFile);
        try {
          const jsonData = await readJSON(jsonPath);
          if (jsonData && jsonData.aweme_id === awemeId) {
            return jsonPath;
          }
        } catch (error) {
          // 忽略读取失败的JSON文件
          continue;
        }
      }
      
      // 检查photos目录下的子目录（幻灯片内容）
      const dirs = [];
      for (const f of files) {
        const fullPath = path.join(photosDir, f);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          dirs.push(f);
        }
      }
      
      for (const dir of dirs) {
        const slideDir = path.join(photosDir, dir);
        const slideFiles = await fs.readdir(slideDir);
        const slideJsonFiles = slideFiles.filter(f => f.endsWith('.json'));
        
        for (const jsonFile of slideJsonFiles) {
          const jsonPath = path.join(slideDir, jsonFile);
          try {
            const jsonData = await readJSON(jsonPath);
            if (jsonData && jsonData.aweme_id === awemeId) {
              return jsonPath;
            }
          } catch (error) {
            // 忽略读取失败的JSON文件
            continue;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`查找JSON文件失败 (${userDir}, ${awemeId}):`, error.message);
    return null;
  }
}

/**
 * 从JSON数据中提取常用字段
 */
function extractCommonFields(jsonData) {
  if (!jsonData) {
    return {};
  }
  
  return {
    title: jsonData.share_info?.share_title || jsonData.desc || null,
    description: jsonData.desc || null,
    author_nickname: jsonData.author?.nickname || null,
    author_unique_id: jsonData.author?.unique_id || null,
    digg_count: jsonData.statistics?.digg_count || 0,
    comment_count: jsonData.statistics?.comment_count || 0,
    share_count: jsonData.statistics?.share_count || 0,
    collect_count: jsonData.statistics?.collect_count || 0,
    create_time: jsonData.create_time || null,
    duration: jsonData.duration || jsonData.video?.duration || null,
    video_width: jsonData.video?.width || null,
    video_height: jsonData.video?.height || null,
    music_title: jsonData.music?.title || null,
    music_author: jsonData.music?.author || null,
    poi_name: jsonData.poi_info?.poi_name || null
  };
}

/**
 * 更新数据库中的视频信息
 */
async function updateVideoInfoInDatabase(awemeId, videoInfoJson, commonFields = {}) {
  try {
    const dbType = process.env.DB_TYPE || (process.env.DB_HOST ? 'mysql' : 'sqlite');
    
    if (dbType === 'mysql' || dbType === 'mariadb') {
      // MySQL/MariaDB
      const mysql = require('mysql2/promise');
      const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'douyin_downloader'
      };
      
      const connection = await mysql.createConnection(config);
      
      // 构建更新SQL，包含所有常用字段
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
      
      updateValues.push(awemeId);
      
      await connection.execute(
        `UPDATE download_status SET ${updateFields.join(', ')} WHERE aweme_id = ?`,
        updateValues
      );
      await connection.end();
    } else {
      // SQLite
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, '..', 'data', 'download_status.db');
      
      return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          // 构建更新SQL，包含所有常用字段
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
          
          updateValues.push(awemeId);
          
          database.run(
            `UPDATE download_status SET ${updateFields.join(', ')} WHERE aweme_id = ?`,
            updateValues,
            (err) => {
              database.close();
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });
      });
    }
  } catch (error) {
    console.error(`更新数据库失败 (aweme_id: ${awemeId}):`, error.message);
    throw error;
  }
}

/**
 * 获取所有已完成的视频记录
 */
async function getCompletedVideos() {
  try {
    const dbType = process.env.DB_TYPE || (process.env.DB_HOST ? 'mysql' : 'sqlite');
    
    if (dbType === 'mysql' || dbType === 'mariadb') {
      // MySQL/MariaDB
      const mysql = require('mysql2/promise');
      const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'douyin_downloader'
      };
      
      const connection = await mysql.createConnection(config);
      const [rows] = await connection.query(
        "SELECT aweme_id, user_id, user_name FROM download_status WHERE status = 'completed'"
      );
      await connection.end();
      return rows;
    } else {
      // SQLite
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, '..', 'data', 'download_status.db');
      
      return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          database.all(
            "SELECT aweme_id, user_id, user_name FROM download_status WHERE status = 'completed'",
            (err, rows) => {
              database.close();
              if (err) {
                reject(err);
              } else {
                resolve(rows || []);
              }
            }
          );
        });
      });
    }
  } catch (error) {
    console.error('获取已完成视频列表失败:', error.message);
    throw error;
  }
}

/**
 * 检查video_info是否已存在
 */
async function hasVideoInfo(awemeId) {
  try {
    const dbType = process.env.DB_TYPE || (process.env.DB_HOST ? 'mysql' : 'sqlite');
    
    if (dbType === 'mysql' || dbType === 'mariadb') {
      // MySQL/MariaDB
      const mysql = require('mysql2/promise');
      const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'douyin_downloader'
      };
      
      const connection = await mysql.createConnection(config);
      const [rows] = await connection.query(
        'SELECT video_info FROM download_status WHERE aweme_id = ?',
        [awemeId]
      );
      await connection.end();
      return rows.length > 0 && rows[0].video_info !== null && rows[0].video_info !== '';
    } else {
      // SQLite
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, '..', 'data', 'download_status.db');
      
      return new Promise((resolve, reject) => {
        const database = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          database.get(
            'SELECT video_info FROM download_status WHERE aweme_id = ?',
            [awemeId],
            (err, row) => {
              database.close();
              if (err) {
                reject(err);
              } else {
                resolve(row && row.video_info !== null && row.video_info !== '');
              }
            }
          );
        });
      });
    }
  } catch (error) {
    console.error(`检查video_info失败 (aweme_id: ${awemeId}):`, error.message);
    return false;
  }
}

/**
 * 主函数
 * @param {boolean} forceUpdate - 是否强制更新已有数据的记录
 */
async function main(forceUpdate = false) {
  console.log('开始处理已下载视频的JSON信息...\n');
  if (forceUpdate) {
    console.log('⚠️  强制更新模式：将更新所有记录（包括已有video_info的记录）\n');
  }
  
  try {
    // 1. 确保video_info字段存在
    console.log('步骤1: 检查并添加video_info字段...');
    await ensureVideoInfoColumn();
    console.log('');
    
    // 2. 获取所有已完成的视频记录
    console.log('步骤2: 获取所有已完成的视频记录...');
    const completedVideos = await getCompletedVideos();
    console.log(`找到 ${completedVideos.length} 个已完成的视频记录\n`);
    
    if (completedVideos.length === 0) {
      console.log('没有找到已完成的视频记录，退出。');
      return;
    }
    
    // 3. 遍历处理每个视频
    console.log('步骤3: 开始处理视频JSON信息...\n');
    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    
    for (const video of completedVideos) {
      const { aweme_id, user_name } = video;
      
      try {
        // 检查是否已有video_info（除非强制更新）
        if (!forceUpdate) {
          const hasInfo = await hasVideoInfo(aweme_id);
          if (hasInfo) {
            console.log(`[跳过] ${aweme_id} (${user_name}) - 已有video_info`);
            skippedCount++;
            continue;
          }
        }
        
        // 查找对应的JSON文件
        const userDir = path.join(DOWNLOAD_DIR, user_name);
        const jsonPath = await findJsonFileByAwemeId(userDir, aweme_id);
        
        if (!jsonPath) {
          console.log(`[未找到] ${aweme_id} (${user_name}) - 未找到对应的JSON文件`);
          notFoundCount++;
          continue;
        }
        
        // 读取JSON内容
        const jsonData = await readJSON(jsonPath);
        if (!jsonData) {
          console.log(`[错误] ${aweme_id} (${user_name}) - JSON文件读取失败`);
          errorCount++;
          continue;
        }
        
        // 将JSON转换为字符串
        const videoInfoJson = JSON.stringify(jsonData);
        
        // 提取常用字段
        const commonFields = extractCommonFields(jsonData);
        
        // 更新数据库
        await updateVideoInfoInDatabase(aweme_id, videoInfoJson, commonFields);
        console.log(`[更新] ${aweme_id} (${user_name}) - 成功更新video_info和常用字段`);
        updatedCount++;
        
        processedCount++;
        
        // 每处理10个视频显示一次进度
        if (processedCount % 10 === 0) {
          console.log(`\n进度: 已处理 ${processedCount}/${completedVideos.length} 个视频\n`);
        }
      } catch (error) {
        console.error(`[错误] ${aweme_id} (${user_name}) - ${error.message}`);
        errorCount++;
      }
    }
    
    // 4. 显示统计信息
    console.log('\n' + '='.repeat(60));
    console.log('处理完成！统计信息:');
    console.log(`  总记录数: ${completedVideos.length}`);
    console.log(`  已更新: ${updatedCount}`);
    console.log(`  已跳过（已有数据）: ${skippedCount}`);
    console.log(`  未找到JSON文件: ${notFoundCount}`);
    console.log(`  处理错误: ${errorCount}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('处理过程中发生错误:', error);
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  // 检查命令行参数
  const forceUpdate = process.argv.includes('--force') || process.argv.includes('-f');
  
  main(forceUpdate).catch(error => {
    console.error('脚本执行失败:', error);
    process.exit(1);
  });
}

module.exports = { main };

