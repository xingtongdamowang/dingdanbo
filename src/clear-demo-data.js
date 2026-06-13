const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const config = require('./config');

async function main() {
  const sql = fs.readFileSync(path.join(config.rootDir, 'sql/clear-demo-data.sql'), 'utf8');
  const [result] = await pool.query(sql);
  console.log(`已清理演示记录：${result.affectedRows || 0} 条`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
