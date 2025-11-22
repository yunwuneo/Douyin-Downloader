const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const path = require('path');
const { ensureDirectory } = require('./utils');
const db = require('./db');

const execAsync = promisify(exec);

/**
 * 视频处理服务
 * 负责从视频中提取帧、处理视频等
 */
class VideoProcessor {
  constructor() {
    this.framesDir = path.join(__dirname, '../data/frames');
    this.framesPerVideo = parseInt(process.env.FRAMES_PER_VIDEO) || 5; // 每个视频提取的帧数
  }

  /**
   * 初始化，确保目录存在
   */
  async init() {
    await ensureDirectory(this.framesDir);
  }

  /**
   * 检查ffmpeg是否安装
   */
  async checkFFmpeg() {
    try {
      await execAsync('ffmpeg -version');
      return true;
    } catch (error) {
      console.error('FFmpeg未安装或不在PATH中:', error.message);
      return false;
    }
  }

  /**
   * 获取视频时长（秒）
   */
  async getVideoDuration(videoPath) {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      );
      return parseFloat(stdout.trim());
    } catch (error) {
      console.error(`获取视频时长失败 (${videoPath}):`, error.message);
      return 0;
    }
  }

  /**
   * 从视频中提取帧
   * @param {string} videoPath - 视频路径
   * @param {string} aweme_id - 作品ID
   * @returns {Promise<Array<string>>} 提取的帧文件路径数组
   */
  async extractFrames(videoPath, aweme_id) {
    try {
      // 检查ffmpeg是否可用
      const ffmpegAvailable = await this.checkFFmpeg();
      if (!ffmpegAvailable) {
        console.warn('FFmpeg不可用，跳过帧提取');
        return [];
      }

      // 检查视频文件是否存在
      if (!(await fs.pathExists(videoPath))) {
        console.warn(`视频文件不存在: ${videoPath}`);
        return [];
      }

      // 获取视频时长
      const duration = await this.getVideoDuration(videoPath);
      if (duration === 0) {
        console.warn(`无法获取视频时长: ${videoPath}`);
        return [];
      }

      // 创建作品专属的帧目录
      const awemeFramesDir = path.join(this.framesDir, aweme_id);
      await ensureDirectory(awemeFramesDir);

      const framePaths = [];
      const frameInterval = duration / (this.framesPerVideo + 1); // 均匀分布时间点

      // 提取帧
      for (let i = 1; i <= this.framesPerVideo; i++) {
        const timestamp = frameInterval * i;
        const framePath = path.join(awemeFramesDir, `frame_${i}.jpg`);
        
        try {
          // 使用ffmpeg提取帧
          await execAsync(
            `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" -y`
          );

          if (await fs.pathExists(framePath)) {
            framePaths.push(framePath);
            console.log(`提取帧成功: ${framePath} (时间点: ${timestamp.toFixed(2)}s)`);
          }
        } catch (error) {
          console.error(`提取帧失败 (时间点: ${timestamp}s):`, error.message);
        }
      }

      return framePaths;
    } catch (error) {
      console.error(`提取视频帧时出错 (${videoPath}):`, error.message);
      return [];
    }
  }

  /**
   * 处理视频并提取帧
   * @param {string} videoPath - 视频路径
   * @param {string} aweme_id - 作品ID
   * @returns {Promise<Array<{index: number, path: string}>>} 帧信息数组
   */
  async processVideo(videoPath, aweme_id) {
    try {
      console.log(`开始处理视频: ${videoPath} (aweme_id: ${aweme_id})`);
      
      const framePaths = await this.extractFrames(videoPath, aweme_id);
      
      const frames = framePaths.map((framePath, index) => ({
        index: index + 1,
        path: framePath
      }));

      // 保存帧信息到数据库
      for (const frame of frames) {
        await db.saveVideoFrame(aweme_id, frame.index, frame.path, null);
      }

      console.log(`视频处理完成，提取了 ${frames.length} 帧`);
      return frames;
    } catch (error) {
      console.error(`处理视频失败:`, error.message);
      return [];
    }
  }

  /**
   * 删除视频的帧文件（可选，用于清理）
   */
  async cleanupFrames(aweme_id) {
    try {
      const awemeFramesDir = path.join(this.framesDir, aweme_id);
      if (await fs.pathExists(awemeFramesDir)) {
        await fs.remove(awemeFramesDir);
        console.log(`已清理帧目录: ${awemeFramesDir}`);
      }
    } catch (error) {
      console.error(`清理帧目录失败:`, error.message);
    }
  }
}

module.exports = new VideoProcessor();



