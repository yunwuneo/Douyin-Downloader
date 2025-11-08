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
   * 执行所有用户的监控
   */
  async monitorAllUsers() {
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