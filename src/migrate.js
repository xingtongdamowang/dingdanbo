const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function main() {
  const { database, ...connectionConfig } = config.database;
  const connection = await mysql.createConnection({
    ...connectionConfig,
    multipleStatements: true
  });

  try {
    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (error) {
      const denied = ['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(error.code);
      if (!denied) throw error;
      console.warn(`当前账号不能创建数据库，将尝试直接使用已存在的 ${database}`);
    }
    await connection.changeUser({ database });

    const schema = fs.readFileSync(path.join(config.rootDir, 'sql/schema.sql'), 'utf8');
    await connection.query(schema);

    console.log(`数据库 ${database} 初始化完成`);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
