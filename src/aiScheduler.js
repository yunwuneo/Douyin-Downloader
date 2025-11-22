const schedule = require('node-schedule');
const summaryService = require('./summaryService');
const emailService = require('./emailService');
require('dotenv').config();

/**
 * AI功能定时任务调度器
 * 负责定时生成每日总结并发送邮件
 */
class AIScheduler {
  constructor() {
    this.jobs = [];
    this.scheduleTime = process.env.AI_DAILY_SCHEDULE_TIME || '18:00'; // 默认每天18:00
  }

  /**
   * 解析时间字符串（格式: HH:MM）
   */
  parseScheduleTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length !== 2) {
      throw new Error('时间格式错误，应为 HH:MM');
    }
    const hour = parseInt(parts[0]);
    const minute = parseInt(parts[1]);
    
    if (isNaN(hour) || hour < 0 || hour > 23) {
      throw new Error('小时必须在0-23之间');
    }
    if (isNaN(minute) || minute < 0 || minute > 59) {
      throw new Error('分钟必须在0-59之间');
    }
    
    return { hour, minute };
  }

  /**
   * 执行每日总结任务
   */
  async executeDailySummary() {
    try {
      console.log('========== 开始执行每日总结任务 ==========');
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      
      console.log(`生成日期: ${dateStr}`);

      // 生成每日总结
      console.log('正在生成每日总结...');
      const summary = await summaryService.generateDailySummary(dateStr);
      
      if (!summary) {
        console.log('今日没有视频需要总结，跳过邮件发送');
        return;
      }

      console.log(`总结生成完成: ${summary.videoCount} 个视频`);

      // 初始化邮件服务
      await emailService.init();

      // 发送邮件
      console.log('正在发送邮件...');
      const emailSent = await emailService.sendDailySummary(summary, summary.webuiToken);
      
      if (emailSent) {
        // 标记邮件已发送
        await require('./db').markDailySummaryEmailSent(dateStr);
        console.log('邮件发送成功');
      } else {
        console.warn('邮件发送失败');
      }

      console.log('========== 每日总结任务完成 ==========');
    } catch (error) {
      console.error('执行每日总结任务时出错:', error.message);
      console.error(error.stack);
    }
  }

  /**
   * 启动定时任务
   */
  start() {
    try {
      console.log('启动AI定时任务调度器...');
      
      const { hour, minute } = this.parseScheduleTime(this.scheduleTime);
      console.log(`定时任务设置: 每天 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);

      // 创建定时任务（每天指定时间执行）
      const job = schedule.scheduleJob(
        { hour, minute, tz: 'Asia/Shanghai' },
        () => {
          this.executeDailySummary();
        }
      );

      if (job) {
        this.jobs.push(job);
        console.log('AI定时任务启动成功');
        
        // 立即执行一次（如果当前时间还没到）
        const now = new Date();
        const scheduledTime = new Date();
        scheduledTime.setHours(hour, minute, 0, 0);
        
        if (now >= scheduledTime) {
          // 如果今天的时间已过，立即执行一次
          console.log('今日时间已过，立即执行一次每日总结...');
          this.executeDailySummary();
        }
      } else {
        console.error('启动定时任务失败');
      }
    } catch (error) {
      console.error('启动AI定时任务时出错:', error.message);
    }
  }

  /**
   * 停止定时任务
   */
  stop() {
    console.log('停止AI定时任务调度器...');
    this.jobs.forEach(job => {
      if (job) {
        job.cancel();
      }
    });
    this.jobs = [];
    console.log('AI定时任务已停止');
  }

  /**
   * 手动触发每日总结（用于测试）
   */
  async triggerNow() {
    console.log('手动触发每日总结任务...');
    await this.executeDailySummary();
  }
}

module.exports = new AIScheduler();



