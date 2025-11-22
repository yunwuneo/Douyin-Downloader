const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * 邮件发送服务
 * 支持多种SMTP服务器配置
 */
class EmailService {
  constructor() {
    // ========== 基础配置 ==========
    this.transporter = null;
    this.fromEmail = process.env.EMAIL_FROM;
    this.toEmail = process.env.EMAIL_TO;
    this.webuiBaseUrl = process.env.WEBUI_BASE_URL || 'http://localhost:3001';
    
    // ========== SMTP服务器配置 ==========
    this.emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
    this.emailPort = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT) || 587;
    this.emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
    this.emailPassword = process.env.EMAIL_PASSWORD || process.env.SMTP_PASSWORD;
    
    // ========== 安全配置 ==========
    // secure: 如果为true，使用SSL（端口465），如果为false，使用STARTTLS（端口587或25）
    const securePort = parseInt(process.env.EMAIL_SECURE_PORT || process.env.SMTP_SECURE_PORT) || 465;
    const useSecure = process.env.EMAIL_SECURE === 'true' || this.emailPort === securePort;
    const requireTLS = process.env.EMAIL_REQUIRE_TLS === 'true';
    const ignoreTLS = process.env.EMAIL_IGNORE_TLS === 'true';
    
    this.secure = useSecure;
    this.requireTLS = requireTLS;
    this.ignoreTLS = ignoreTLS;
    
    // ========== TLS配置 ==========
    this.tls = {
      // 是否拒绝未授权的证书（生产环境建议true）
      rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false',
      // 最小TLS版本
      minVersion: process.env.EMAIL_TLS_MIN_VERSION || 'TLSv1.2',
      // 自定义CA证书（可选）
      ca: process.env.EMAIL_TLS_CA ? [process.env.EMAIL_TLS_CA] : undefined,
      // 自定义客户端证书（可选）
      cert: process.env.EMAIL_TLS_CERT,
      key: process.env.EMAIL_TLS_KEY
    };
    
    // ========== 连接配置 ==========
    this.connectionTimeout = parseInt(process.env.EMAIL_CONNECTION_TIMEOUT || process.env.SMTP_CONNECTION_TIMEOUT) || 2000; // 2秒
    this.greetingTimeout = parseInt(process.env.EMAIL_GREETING_TIMEOUT || process.env.SMTP_GREETING_TIMEOUT) || 3000; // 3秒
    this.socketTimeout = parseInt(process.env.EMAIL_SOCKET_TIMEOUT || process.env.SMTP_SOCKET_TIMEOUT) || 60000; // 60秒
    
    // ========== 代理配置 ==========
    this.proxy = process.env.EMAIL_PROXY || process.env.SMTP_PROXY || null;
    
    // ========== 调试配置 ==========
    this.debug = process.env.EMAIL_DEBUG === 'true';
    this.logger = this.debug ? console.log : false;
    
    // ========== 预设邮件服务商配置 ==========
    this.presetProvider = process.env.EMAIL_PROVIDER || process.env.SMTP_PROVIDER || 'custom';
    this.loadPresetConfig();
  }
  
  /**
   * 加载预设邮件服务商配置
   */
  loadPresetConfig() {
    const presets = {
      'gmail': {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      'outlook': {
        host: 'smtp-mail.outlook.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      'qq': {
        host: 'smtp.qq.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      '163': {
        host: 'smtp.163.com',
        port: 465,
        secure: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      '126': {
        host: 'smtp.126.com',
        port: 465,
        secure: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      'sina': {
        host: 'smtp.sina.com',
        port: 465,
        secure: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      'yahoo': {
        host: 'smtp.mail.yahoo.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      },
      'custom': null // 使用自定义配置
    };
    
    // 如果使用预设配置，应用预设值（但环境变量优先级更高）
    if (presets[this.presetProvider] && !process.env.EMAIL_HOST && !process.env.SMTP_HOST) {
      const preset = presets[this.presetProvider];
      this.emailHost = preset.host;
      if (!process.env.EMAIL_PORT && !process.env.SMTP_PORT) {
        this.emailPort = preset.port;
      }
      if (!process.env.EMAIL_SECURE) {
        this.secure = preset.secure;
      }
      if (!process.env.EMAIL_REQUIRE_TLS && preset.requireTLS) {
        this.requireTLS = preset.requireTLS;
      }
      
      console.log(`[邮件服务] 使用预设配置: ${this.presetProvider}`);
      console.log(`[邮件服务] 服务器: ${this.emailHost}:${this.emailPort}`);
    }
  }

  /**
   * 初始化邮件传输器
   */
  async init() {
    try {
      if (!this.emailUser || !this.emailPassword) {
        console.warn('未配置邮件服务，邮件功能将不可用');
        return false;
      }

      this.transporter = nodemailer.createTransport({
        host: this.emailHost,
        port: this.emailPort,
        secure: this.emailPort === 465, // true for 465, false for other ports
        auth: {
          user: this.emailUser,
          pass: this.emailPassword
        }
      });

      // 验证连接
      await this.transporter.verify();
      console.log('邮件服务初始化成功');
      return true;
    } catch (error) {
      console.error('邮件服务初始化失败:', error.message);
      return false;
    }
  }

  /**
   * 发送邮件
   */
  async sendEmail(subject, html, attachments = []) {
    try {
      if (!this.transporter || !this.toEmail) {
        console.warn('邮件服务未初始化或未配置收件人，跳过发送');
        return false;
      }

      const mailOptions = {
        from: this.fromEmail || this.emailUser,
        to: this.toEmail,
        subject: subject,
        html: html,
        attachments: attachments
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('邮件发送成功:', info.messageId);
      return true;
    } catch (error) {
      console.error('邮件发送失败:', error.message);
      return false;
    }
  }

  /**
   * 生成每日总结的HTML内容
   */
  generateDailySummaryHTML(summaryData, webuiToken) {
    const { date, videoCount, videos, summaryId } = summaryData;
    const webuiUrl = `${this.webuiBaseUrl}/preference?token=${webuiToken}&date=${date}`;

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
    }
    .summary-stats {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .summary-stats h2 {
      margin-top: 0;
      color: #667eea;
    }
    .video-list {
      margin-top: 20px;
    }
    .video-item {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .video-item h3 {
      margin-top: 0;
      color: #333;
    }
    .video-meta {
      color: #666;
      font-size: 14px;
      margin: 10px 0;
    }
    .video-description {
      color: #555;
      margin-top: 10px;
      line-height: 1.5;
    }
    .tags {
      margin-top: 10px;
    }
    .tag {
      display: inline-block;
      background: #e3f2fd;
      color: #1976d2;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-right: 5px;
      margin-top: 5px;
    }
    .webui-link {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 15px 30px;
      border-radius: 8px;
      text-decoration: none;
      margin-top: 30px;
      font-weight: bold;
      text-align: center;
    }
    .webui-link:hover {
      background: #5568d3;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📹 今日视频下载总结</h1>
    <p>${date}</p>
  </div>

  <div class="summary-stats">
    <h2>📊 统计信息</h2>
    <p><strong>今日下载视频数量:</strong> ${videoCount}</p>
    <p><strong>生成时间:</strong> ${new Date().toLocaleString('zh-CN')}</p>
  </div>

  <div class="video-list">
    <h2>🎬 视频列表</h2>
`;

    videos.forEach((video, index) => {
      const features = video.ai_features || {};
      const tags = features.top_tags || [];
      
      html += `
    <div class="video-item">
      <h3>${index + 1}. ${video.user_name} - ${video.aweme_id}</h3>
      <div class="video-meta">
        <strong>作者:</strong> ${video.user_name} | 
        <strong>视频ID:</strong> ${video.aweme_id}
      </div>
      ${features.description_summary ? `
      <div class="video-description">
        <strong>内容描述:</strong> ${features.description_summary.substring(0, 200)}${features.description_summary.length > 200 ? '...' : ''}
      </div>
      ` : ''}
      ${tags.length > 0 ? `
      <div class="tags">
        ${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
      </div>
      ` : ''}
    </div>
`;
    });

    html += `
  </div>

  <div style="text-align: center; margin-top: 30px;">
    <a href="${webuiUrl}" class="webui-link">✨ 告诉我你喜欢哪些视频</a>
    <p style="margin-top: 15px; color: #666; font-size: 14px;">
      点击上面的链接，选择你喜欢的视频，帮助我们更好地了解你的偏好！
    </p>
  </div>

  <div class="footer">
    <p>此邮件由抖音视频下载器自动生成</p>
    <p>链接有效期：7天</p>
  </div>
</body>
</html>
`;

    return html;
  }

  /**
   * 发送每日总结邮件
   */
  async sendDailySummary(summaryData, webuiToken) {
    try {
      const date = summaryData.date || new Date().toISOString().split('T')[0];
      const subject = `📹 抖音视频下载总结 - ${date}`;
      const html = this.generateDailySummaryHTML(summaryData, webuiToken);

      const success = await this.sendEmail(subject, html);
      return success;
    } catch (error) {
      console.error('发送每日总结邮件失败:', error.message);
      return false;
    }
  }
}

module.exports = new EmailService();


