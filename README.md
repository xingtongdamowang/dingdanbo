# 球单簿

基于现有 `index.html` 原型整理出的可部署版本：前端继续使用原生 HTML/CSS/JS，后端使用 Express 提供 API，数据持久化到 MySQL。

## 技术选择

2C2G 服务器上不建议为了这个页面引入 Next.js、Nuxt、Spring Boot 或完整前端构建链。当前页面交互已经是原生 JS，最省资源的落地方式是：

- 前端：保留原型页面，静态文件由 Express 托管。
- 后端：Node.js + Express，只提供记录、核验、统计和票据识别 API。
- 数据库：MySQL 8，使用 InnoDB + utf8mb4。
- 部署：Nginx 反向代理到 Node 进程，Node 进程可用 systemd 或 pm2 托管。

## 本地运行

```bash
cp .env.example .env
npm install
npm run db:seed
npm start
```

浏览器打开 `http://localhost:3000`。

如果只想建表不写入演示数据，执行：

```bash
npm run db:init
```

## 服务器操作脚本

Linux 服务器先把 `.env` 填好，然后执行：

```bash
bash scripts/init-db.sh
```

如果数据库还没有创建，并且当前账号有建库权限：

```bash
bash scripts/init-db.sh --create-db
```

如果要导入演示数据：

```bash
bash scripts/init-db.sh --seed
```

如果想安装依赖、初始化数据库并直接启动应用：

```bash
bash scripts/start-server.sh
```

Windows 本机也可以直接操作服务器上的 MySQL：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init-db.ps1
```

如果你还没有给应用创建数据库账号，先执行：

```bash
bash scripts/create-db-user.sh
```

Ubuntu 本机 MySQL 的 `root` 如果走 socket 登录，可以用：

```bash
USE_SUDO=1 bash scripts/create-db-user.sh
```

如果应用不在数据库同一台服务器，把账号授权给远程连接：

```bash
APP_DB_HOST=% bash scripts/create-db-user.sh
```

## MySQL 账号示例

```sql
CREATE DATABASE qiudanbu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'qiudanbu'@'%' IDENTIFIED BY 'change_me';
GRANT ALL PRIVILEGES ON qiudanbu.* TO 'qiudanbu'@'%';
FLUSH PRIVILEGES;
```

生产环境建议把 `'%'` 改成应用服务器内网 IP 或 `localhost`。

## API

- `GET /api/health`
- `GET /api/records`
- `POST /api/records`
- `PATCH /api/records/:id/settle`
- `GET /api/stats?range=recent|month|all`
- `POST /api/tickets/recognize`

票据识别接口默认会返回演示解析结果。接入真实识别服务时，在 `.env` 配置：

```bash
TICKET_PARSE_API_URL=https://api.example.com/v1/ticket/parse
TICKET_PARSE_API_KEY=your_token
```

## 2C2G 部署建议

Nginx 负责 HTTPS 和静态压缩，Node 只跑一个进程即可。数据库连接池默认 5 个连接，适合小服务器；如果并发较高再调大。

生产启动命令：

```bash
npm install --omit=dev
npm run db:init
npm start
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
