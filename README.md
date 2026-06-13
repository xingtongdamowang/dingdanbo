# 球单簿

基于 `index.html` 原型整理出的可部署版本：原生前端 + Node.js Express API + MySQL。

## 运行

```bash
cp .env.example .env
npm install
npm run db:init
npm start
```

浏览器打开 `http://localhost:3000`。

## 数据库

`.env` 示例：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=qiudanbu
DB_PASSWORD=hebingqi-123
DB_NAME=qiudanbu
```

初始化只会建表，不会写入演示数据：

```bash
npm run db:init
```

如果服务器数据库里已经有旧演示记录，执行：

```bash
npm run db:clear-demo
```

也可以直接执行：

```bash
mysql -h 127.0.0.1 -P 3306 -u qiudanbu -p qiudanbu < sql/clear-demo-data.sql
```

## 识别 API

票据识别现在只调用真实接口，不再返回演示识别结果。未配置接口时会返回错误。

```env
TICKET_PARSE_API_URL=https://api.example.com/v1/ticket/parse
TICKET_PARSE_API_KEY=your_token
TICKET_PARSE_API_MODE=openai
TICKET_PARSE_MODEL=gpt-5.5
ALLOW_CLIENT_AI_ENDPOINT=false
```

页面里有“测试 API”按钮，对应接口：

```text
POST /api/tickets/recognize/test
```

公网部署固定使用服务器 `.env` 里的 `TICKET_PARSE_API_URL`，前端不会显示或提交 API 地址和 Key。

## 部署

```bash
npm install --omit=dev
npm run db:init
npm run db:clear-demo
npm start
```

如果使用 pm2：

```bash
pm2 restart all
```

Nginx 反代示例：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
