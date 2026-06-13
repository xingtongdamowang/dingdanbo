const path = require('path');

require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'storage/uploads'),
  port: numberFromEnv('PORT', 3000),
  database: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: numberFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'qiudanbu',
    connectionLimit: numberFromEnv('DB_CONNECTION_LIMIT', 5)
  },
  upload: {
    maxBytes: numberFromEnv('MAX_UPLOAD_MB', 5) * 1024 * 1024
  },
  ai: {
    ticketParseUrl: process.env.TICKET_PARSE_API_URL || '',
    ticketParseApiKey: process.env.TICKET_PARSE_API_KEY || '',
    ticketParseMode: process.env.TICKET_PARSE_API_MODE || 'auto',
    ticketParseModel: process.env.TICKET_PARSE_MODEL || 'gpt-5.5',
    allowClientEndpoint: process.env.ALLOW_CLIENT_AI_ENDPOINT === 'true'
  }
};
