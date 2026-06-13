const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const apiRouter = require('./routes/api');

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRouter);
app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: '接口不存在' } });
});

app.use(express.static(config.publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const statusCode = error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message =
    statusCode === 500
      ? '服务器内部错误，请检查日志'
      : error.message || '请求处理失败';

  if (statusCode === 500) console.error(error);
  res.status(statusCode).json({ error: { message } });
});

app.listen(config.port, () => {
  console.log(`球单簿已启动：http://localhost:${config.port}`);
});
