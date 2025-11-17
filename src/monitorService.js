const schedule = require('node-schedule');
const { readJSON, saveJSON } = require('./utils');
const apiClient = require('./apiClient');
const downloader = require('./downloader');
const db = require('./db');
const path = require('path');
require('dotenv').config();

class MonitorService {
  constructor() {
    this.configPath = path.join(__dirname, '../config.json');
    this.config = null;
    this.jobs = [];
    this.monitorInterval = parseInt(process.env.MONITOR_INTERVAL) || 3600000; // 默认1小时
    this.monitorIgnore = process.env.MONITOR_IGNORE || ''; // 忽略时间段，格式: "22:00-06:00" 或 "22:00-06:00,14:00-15:00"
    this.timezone = 'Asia/Shanghai';
  }

  /**
   * 加载配置文件
   */
  async loadConfig() {
    try {
      this.config = await readJSON(this.configPath);
      console.log('配置文件加载成功');
      return this.config;
    } catch (error) {
      console.error('加载配置文件失败:', error.message);
      throw error;
    }
  }

  /**
   * 保存配置文件
   */
  async saveConfig() {
    try {
      await saveJSON(this.configPath, this.config);
      console.log('配置文件已保存');
    } catch (error) {
      console.error('保存配置文件失败:', error.message);
      throw error;
    }
  }

  /**
   * 监控单个用户
   * @param {object} user - 用户配置
   */
  async monitorUser(user) {
    console.log(`开始监控用户: ${user.username} (${user.monitor_type})`);
    
    try {
      // 获取用户内容
      const response = await apiClient.fetchUserContent(user, this.config.settings);
      
      if (response.code !== 200 || !response.data) {
        console.error(`获取用户 ${user.username} 数据失败:`, response.message || '未知错误');
        return;
      }
      
      const { aweme_list: items, max_cursor, has_more } = response.data;
      
      // 如果没有新作品
      if (!items || items.length === 0) {
        console.log(`用户 ${user.username} 没有新作品`);
        return;
      }
      
      console.log(`发现 ${user.username} 的 ${items.length} 个作品`);
      
      // 将作品信息保存到数据库
      await db.saveItems(user, items);
      console.log(`已将 ${items.length} 个作品信息保存到数据库`);
      
      // 下载待处理的作品
      await downloader.processItems(items, user.username);
      
      // 更新用户的最大游标
      await db.updateUserCursor(user.sec_user_id, max_cursor);
      
      // 记录最大游标到配置文件（作为备份）
      user.max_cursor = max_cursor;
      await this.saveConfig();
      
      // 获取用户下载统计
      const stats = await db.getUserStats(user.sec_user_id);
      console.log(`${user.username} 下载统计:`, stats);
      
      // 如果还有更多内容，继续获取
      if (has_more) {
        console.log(`用户 ${user.username} 还有更多作品，将继续获取`);
        await this.monitorUser(user);
      }
    } catch (error) {
      console.error(`监控用户 ${user.username} 时出错:`, error.message);
    }
  }

  /**
   * 获取当前时间（Asia/Shanghai 时区）
   * @returns {object} 包含 hour 和 minute 的对象
   */
  getCurrentTimeInTimezone() {
    const now = new Date();
    // 使用 Intl API 获取指定时区的当前时间
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour').value);
    const minute = parseInt(parts.find(p => p.type === 'minute').value);
    
    return { hour, minute };
  }

  /**
   * 解析时间段字符串
   * @param {string} timeRange - 时间段字符串，格式: "HH:mm-HH:mm"
   * @returns {object} 包含 start 和 end 的对象，每个都是 {hour, minute}
   */
  parseTimeRange(timeRange) {
    const match = timeRange.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new Error(`无效的时间段格式: ${timeRange}，应为 HH:mm-HH:mm`);
    }
    
    return {
      start: {
        hour: parseInt(match[1]),
        minute: parseInt(match[2])
      },
      end: {
        hour: parseInt(match[3]),
        minute: parseInt(match[4])
      }
    };
  }

  /**
   * 检查当前时间是否在忽略时间段内
   * @returns {boolean} 如果在忽略时间段内返回 true
   */
  isInIgnoreTimeRange() {
    if (!this.monitorIgnore || this.monitorIgnore.trim() === '') {
      return false;
    }

    const { hour: currentHour, minute: currentMinute } = this.getCurrentTimeInTimezone();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    // 解析多个时间段（用逗号分隔）
    const timeRanges = this.monitorIgnore.split(',').map(range => range.trim()).filter(range => range);
    
    for (const range of timeRanges) {
      try {
        const { start, end } = this.parseTimeRange(range);
        const startTimeInMinutes = start.hour * 60 + start.minute;
        const endTimeInMinutes = end.hour * 60 + end.minute;

        // 处理跨天的情况（例如 22:00-06:00）
        if (startTimeInMinutes > endTimeInMinutes) {
          // 跨天：当前时间 >= 开始时间 或 当前时间 <= 结束时间
          if (currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes) {
            return true;
          }
        } else {
          // 不跨天：当前时间在开始和结束时间之间
          if (currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes) {
            return true;
          }
        }
      } catch (error) {
        console.warn(`解析忽略时间段失败: ${range}`, error.message);
      }
    }

    return false;
  }

  /**
   * 执行所有用户的监控
   */
  async monitorAllUsers() {
    // 检查是否在忽略时间段内
    if (this.isInIgnoreTimeRange()) {
      const { hour, minute } = this.getCurrentTimeInTimezone();
      const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      console.log(`当前时间 ${timeStr} (${this.timezone}) 在忽略监控时间段内，跳过本次监控`);
      return;
    }

    console.log('========== 开始监控所有用户 ==========');
    
    if (!this.config) {
      await this.loadConfig();
    }
    
    for (const user of this.config.users) {
      await this.monitorUser(user);
      // 每个用户监控间隔
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('========== 监控完成 ==========');
  }

  /**
   * 启动定时监控
   */
  async start() {
    console.log('启动抖音作品监控服务...');
    
    // 初始化数据库
    await db.init();
    
    // 立即执行一次监控
    await this.monitorAllUsers();
    
    // 设置定时任务
    const interval = Math.floor(this.monitorInterval / 1000); // 转换为秒
    console.log(`将每隔 ${interval} 秒执行一次监控`);
    
    // 使用node-schedule设置定时任务
    const rule = new schedule.RecurrenceRule();
    rule.second = 0;
    rule.minute = Math.floor((interval / 60) % 60);
    rule.hour = Math.floor(interval / 3600);
    
    const job = schedule.scheduleJob(rule, async () => {
      await this.monitorAllUsers();
    });
    
    this.jobs.push(job);
    
    console.log('监控服务已启动');
  }

  /**
   * 停止监控服务
   */
  stop() {
    console.log('停止监控服务...');
    
    // 取消所有定时任务
    for (const job of this.jobs) {
      job.cancel();
    }
    
    this.jobs = [];
    
    // 关闭数据库连接
    db.close();
    
    console.log('监控服务已停止');
  }

  /**
   * 添加新的监控用户
   * @param {object} userConfig - 用户配置对象
   */
  async addUser(userConfig) {
    if (!this.config) {
      await this.loadConfig();
    }
    
    // 检查用户是否已存在
    const exists = this.config.users.some(u => u.sec_user_id === userConfig.sec_user_id);
    if (exists) {
      console.log(`用户 ${userConfig.username} 已存在于监控列表中`);
      return false;
    }
    
    // 添加用户
    this.config.users.push({
      sec_user_id: userConfig.sec_user_id,
      username: userConfig.username,
      monitor_type: userConfig.monitor_type || 'posts',
      max_cursor: 0
    });
    
    await this.saveConfig();
    console.log(`已添加用户 ${userConfig.username} 到监控列表`);
    
    // 立即监控新添加的用户
    await this.monitorUser(this.config.users[this.config.users.length - 1]);
    
    return true;
  }

  /**
   * 移除监控用户
   * @param {string} secUserId - 用户sec_user_id
   */
  async removeUser(secUserId) {
    if (!this.config) {
      await this.loadConfig();
    }
    
    const initialLength = this.config.users.length;
    this.config.users = this.config.users.filter(u => u.sec_user_id !== secUserId);
    
    if (this.config.users.length !== initialLength) {
      await this.saveConfig();
      console.log(`已从监控列表中移除用户`);
      return true;
    }
    
    console.log(`未找到要移除的用户`);
    return false;
  }
}

module.exports = new MonitorService();