const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL 未设置，启动将失败。请在 Render 上配置环境变量。');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Render 的 PG 一般要 SSL
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
