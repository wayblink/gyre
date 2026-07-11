# 部署（Docker / 阿里云 ECS）

本服务是「Fastify 服务端 + 打包好的前端静态 + Postgres」。容器化后一个进程同时提供 `/api/*` 和前端页面。

## 一、配置开关（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTH_DISABLED` | `true` | **登录开关**：`true`=免登录直接进；`false`=启用账号登录 |
| `SEED_ON_INIT` | `true`(代码默认) / `false`(prod compose) | 首次启动是否导入 demo 工作簿。生产用空库启动设 `false` |
| `HOST` | `127.0.0.1` | 容器内必须设 `0.0.0.0` 才能被反代访问（镜像已默认） |
| `PORT` | `60628` | 服务端口 |
| `DATABASE_URL` | — | Postgres 连接串 |
| `STORAGE_DRIVER` | `minio` | 设 `local` 用本地磁盘存储（免 MinIO），文件落在 `/app/data` |

> 登录开关是纯配置项，改 `AUTH_DISABLED` 后重启容器即生效，无需改代码。启用登录（`false`）后首次需通过 `/api/auth/bootstrap` 创建管理员账号。

## 二、单机快速起（app + Postgres）

```bash
# 在项目目录（含 Dockerfile）执行
docker compose -f docker-compose.prod.yml up -d --build
```

- 应用发布在 `127.0.0.1:60628`（仅回环，供反代转发）。
- Postgres、上传文件分别持久化在命名卷 `pgdata`、`appdata`。
- 想启用登录 / 空库启动：`AUTH_DISABLED=false SEED_ON_INIT=false docker compose -f docker-compose.prod.yml up -d --build`。

只构建镜像（不带 compose）：

```bash
docker build -t capmerge:latest .
docker run -d --name capmerge -p 127.0.0.1:60628:60628 \
  -e HOST=0.0.0.0 -e STORAGE_DRIVER=local -e AUTH_DISABLED=false -e SEED_ON_INIT=false \
  -e DATABASE_URL=postgres://user:pass@<db-host>:5432/captable \
  -v capmerge-data:/app/data capmerge:latest
```

## 三、一台 ECS 上跑两个服务 + 同端口按路由分流

两个服务各绑不同内部端口（如 capmerge `60628`、yushi `60629`），前面用 **Nginx 反代独占 80/443**，按**子域名**分流（推荐，两个应用零改动）：

```nginx
server {
    listen 80;
    server_name capmerge.example.com;
    location / {
        proxy_pass http://127.0.0.1:60628;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
    }
}
server {
    listen 80;
    server_name yushi.example.com;
    location / { proxy_pass http://127.0.0.1:60629; proxy_set_header Host $host; }
}
```

ECS 安全组只放行 80/443；两个应用都只绑 `127.0.0.1`，不直接对公网暴露。之后用 certbot 升级到 443 即可。

> 若必须共用一个域名走路径前缀（`/capmerge/`、`/yushi/`），因前端使用根绝对路径，需要把应用改成 `BASE_PATH` 子路径感知模式——需要额外开发，见与维护者确认。

## 四、注意

- 镜像默认 `SEED_ON_INIT=true` 会读取 `database/` 下的 demo 工作簿；prod compose 已改为 `false`，用空库启动更适合生产。
- 升级：`docker compose -f docker-compose.prod.yml up -d --build` 会重建镜像并滚动重启，数据卷不受影响（schema 用 `create ... if not exists` 幂等）。
