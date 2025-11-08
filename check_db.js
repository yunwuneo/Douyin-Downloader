const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function checkDatabaseStatus() {
  const dbPath = path.join(__dirname, 'data', 'download_status.db');
  
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('连接数据库失败:', err.message);
      process.exit(1);
    }
    console.log('数据库连接成功');
    
    // 查询表结构
    console.log('\n--- 表结构 ---');
    db.all("PRAGMA table_info(download_status)", (err, rows) => {
      if (err) {
        console.error('查询表结构失败:', err.message);
        db.close();
        return;
      }
      console.log('表结构:', rows);
    });
    
    // 查询所有记录
    console.log('\n--- 所有记录 ---');
    db.all("SELECT * FROM download_status LIMIT 10", (err, rows) => {
      if (err) {
        console.error('查询记录失败:', err.message);
        db.close();
        return;
      }
      console.log(`找到 ${rows.length} 条记录（显示前10条）:`);
      rows.forEach((row, index) => {
        console.log(`记录 ${index + 1}:`, {
          user_id: row.user_id,
          user_name: row.user_name,
          aweme_id: row.aweme_id,
          status: row.status,
          created_at: row.created_at
        });
      });
      
      // 查询总记录数
      db.get("SELECT COUNT(*) as total FROM download_status", (err, row) => {
        if (err) {
          console.error('查询总记录数失败:', err.message);
        } else {
          console.log(`\n数据库中总记录数: ${row.total}`);
        }
        
        // 查询状态统计
        db.all(
          "SELECT status, COUNT(*) as count FROM download_status GROUP BY status",
          (err, rows) => {
            if (err) {
              console.error('查询状态统计失败:', err.message);
            } else {
              console.log('\n各状态记录数:');
              rows.forEach(row => {
                console.log(`- ${row.status}: ${row.count}`);
              });
            }
            
            db.close();
            console.log('\n数据库检查完成');
          }
        );
      });
    });
  });
}

checkDatabaseStatus();