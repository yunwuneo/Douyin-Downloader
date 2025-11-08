const monitorService = require('./src/monitorService');
const { ensureDirectory } = require('./src/utils');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

/**
 * 初始化应用
 */
async function initializeApp() {
  try {
    console.log('========== 抖音作品监控下载器 ==========');
    
    // 检查环境变量文件
    const envPath = path.join(__dirname, '.env');
    if (!(await fs.pathExists(envPath))) {
      console.warn('警告: 未找到 .env 文件，请根据 .env.example 创建并配置环境变量');
    }
    
    // 确保下载目录存在
    const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
    await ensureDirectory(downloadDir);
    
    // 加载配置
    await monitorService.loadConfig();
    
    // 启动监控服务
    (async () => {
      try {
        await monitorService.start();
      } catch (error) {
        console.error('启动监控服务失败:', error.message);
        process.exit(1);
      }
    })();
    
    // 监听进程信号，优雅关闭
    process.on('SIGINT', () => {
      console.log('\n接收到中断信号，正在停止服务...');
      monitorService.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\n接收到终止信号，正在停止服务...');
      monitorService.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('应用初始化失败:', error.message);
    process.exit(1);
  }
}

/**
 * 命令行界面处理
 */
function handleCommandLineArgs() {
  const args = process.argv.slice(2);
  
  // 简单的命令行参数处理
  if (args.includes('--help') || args.includes('-h')) {
    console.log('抖音作品监控下载器');
    console.log('用法:');
    console.log('  npm start       - 启动监控服务');
    console.log('  npm start -- --help  - 显示帮助信息');
    process.exit(0);
  }
}

// 处理命令行参数
handleCommandLineArgs();

// 初始化应用
initializeApp();