const fs = require('fs-extra');
const path = require('path');

/**
 * 确保目录存在
 * @param {string} dirPath - 目录路径
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.ensureDir(dirPath);
    console.log(`确保目录存在: ${dirPath}`);
  } catch (error) {
    console.error(`创建目录失败: ${error.message}`);
    throw error;
  }
}

/**
 * 格式化时间戳为文件名安全的字符串
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * 保存JSON数据到文件
 * @param {string} filePath - 文件路径
 * @param {object} data - 要保存的数据
 */
async function saveJSON(filePath, data) {
  try {
    await fs.writeJSON(filePath, data, { spaces: 2 });
    console.log(`JSON数据已保存到: ${filePath}`);
  } catch (error) {
    console.error(`保存JSON失败: ${error.message}`);
    throw error;
  }
}

/**
 * 读取JSON文件
 * @param {string} filePath - 文件路径
 * @returns {object} 读取的数据
 */
async function readJSON(filePath) {
  try {
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      return null;
    }
    return await fs.readJSON(filePath);
  } catch (error) {
    console.error(`读取JSON失败: ${error.message}`);
    throw error;
  }
}

/**
 * 获取文件扩展名
 * @param {string} url - 文件URL
 * @returns {string} 文件扩展名
 */
function getFileExtension(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  const ext = path.extname(pathname);
  return ext || '.mp4'; // 默认视频格式
}

module.exports = {
  ensureDirectory,
  formatTimestamp,
  saveJSON,
  readJSON,
  getFileExtension
};