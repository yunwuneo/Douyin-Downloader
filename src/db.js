require('dotenv').config();

// 根据环境变量决定使用哪种数据库
// 如果设置了 DB_TYPE=mysql 或 DB_HOST，则使用 MySQL/MariaDB
const dbType = process.env.DB_TYPE || (process.env.DB_HOST ? 'mysql' : 'sqlite');

if (dbType === 'mysql' || dbType === 'mariadb') {
  console.log('配置检测: 使用 MySQL/MariaDB 数据库');
  module.exports = require('./db_mysql');
} else {
  console.log('配置检测: 使用 SQLite 数据库');
  module.exports = require('./db_sqlite');
}

