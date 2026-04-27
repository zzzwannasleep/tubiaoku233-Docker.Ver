# tubiaoku233

这个项目已经从原来的 `Vercel + GitHub Gist + GitHub Repo / PICUI` 绑定模式，改造成了更通用的 **本地文件存储 + 本地 JSON 索引 + Docker 部署** 方案。

现在它的核心行为是：

- 上传图片后，文件保存在本地目录
- `icons.json` / `icons-square.json` / `icons-circle.json` / `icons-transparent.json` 由当前服务直接生成
- `/manage` 直接管理本地文件和本地 JSON 记录
- 不再依赖 `vercel.json`
- 不再依赖 GitHub Gist 作为索引存储
- 不再依赖 GitHub Repo 作为图床

## 目录结构

```text
project/
├─ api/
│  └─ index.py
├─ static/
├─ templates/
├─ data/                      # 运行后自动创建
│  ├─ icons.json
│  ├─ icons-square.json
│  ├─ icons-circle.json
│  ├─ icons-transparent.json
│  └─ images/
│     ├─ square/
│     ├─ circle/
│     └─ transparent/
├─ .env.example
├─ .dockerignore
├─ docker-compose.yml
├─ Dockerfile
└─ requirements.txt
```

## 快速开始

### 方式一：Docker Compose

1. 复制环境变量文件

```powershell
Copy-Item .env.example .env
```

2. 至少补这几个值

```env
FLASK_SECRET_KEY=换成一个随机长字符串
ADMIN_PASSWORD=换成你的后台密码
PUBLIC_BASE_URL=http://你的域名或IP:8000
```

3. 启动

```bash
docker compose up -d --build
```

4. 访问

- 上传页: `http://127.0.0.1:8000/`
- 编辑页: `http://127.0.0.1:8000/editor`
- 管理后台: `http://127.0.0.1:8000/manage`

### 方式二：本地直接运行

```powershell
pip install -r requirements.txt
Copy-Item .env.example .env
python api/index.py
```

默认会监听：

```text
http://127.0.0.1:8000
```

## 路由说明

| 路由 | 说明 |
| --- | --- |
| `/` | 上传页 |
| `/editor` | 图片裁剪 / 抠图 / 一键上传 |
| `/manage` | 管理后台 |
| `/media/<path>` | 本地图片访问地址 |
| `/icons.json` | 默认分类 JSON |
| `/icons-square.json` | 方形分类 JSON |
| `/icons-circle.json` | 圆形分类 JSON |
| `/icons-transparent.json` | 透明分类 JSON |
| `/healthz` | 健康检查 |

## 环境变量

### 必填

| 变量 | 说明 |
| --- | --- |
| `FLASK_SECRET_KEY` | Cookie 签名密钥，务必修改 |
| `ADMIN_PASSWORD` | 管理后台密码 |

### 常用

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LIBRARY_TITLE` | `图标库` | 页面标题 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8000` | 监听端口 |
| `APP_DATA_DIR` | `./data` | 数据目录 |
| `PUBLIC_BASE_URL` | 空 | 生成完整外链时使用 |
| `MAX_UPLOAD_MB` | `20` | 最大上传大小，单位 MB |
| `COOKIE_SECURE` | `0` | HTTPS 环境建议改成 `1` |
| `ADMIN_ENABLED` | `1` | 是否启用管理后台 |
| `ADMIN_COOKIE_MAX_AGE` | `86400` | 后台登录有效期，单位秒 |
| `ADMIN_PAGE_SIZE` | `24` | 管理后台分页大小 |
| `RANDOM_BG_API` | 空 | 可选的背景图 API |

### AI 抠图可选

| 变量 | 说明 |
| --- | --- |
| `CLIPDROP_API_KEY` | 默认 AI 抠图通道 1 |
| `REMOVEBG_API_KEY` | 默认 AI 抠图通道 2 |
| `CUSTOM_AI_ENABLED` | 是否启用自定义 AI |
| `CUSTOM_AI_PASSWORD` | 自定义 AI 解锁密码 |
| `CUSTOM_AI_URL` | 自定义 AI 接口地址 |
| `CUSTOM_AI_FILE_FIELD` | 上传字段名，默认 `image` |
| `CUSTOM_AI_API_KEY` | 自定义 AI 接口鉴权 Key |
| `CUSTOM_AI_AUTH_HEADER` | 鉴权 Header，默认 `Authorization` |
| `CUSTOM_AI_AUTH_PREFIX` | 鉴权前缀，比如 `Bearer ` |

## Docker 设计说明

- 容器内服务端口固定为 `8000`
- 本地 `./data` 会挂载到容器内 `/app/data`
- 图片和 JSON 都落在挂载卷里，容器重建不会丢
- 服务使用 `gunicorn` 启动，适合长期运行

## GitHub Actions 构建镜像

仓库里已经补了一份工作流：

```text
.github/workflows/docker-image.yml
```

它的默认行为是：

- `push main` 时构建并推送镜像
- 打 `v*` tag 时构建并推送镜像
- `pull_request` 时只构建不推送
- 默认推送到 `ghcr.io/<owner>/<repo>`

如果你就是用 GitHub 工作流出镜像，这份配置可以直接用，不需要再保留任何 Vercel 相关内容。

## 兼容性说明

- 旧的 `/github` 路由现在会重定向到 `/`
- 旧的 Vercel 配置、GitHub Gist 配置、GitHub Repo 图床配置已经移除
- 当前版本不会自动迁移你原来 Gist / PICUI / GitHub Repo 里的远端数据

如果你后面需要，我可以继续帮你补一份“旧 Gist JSON 导入到本地 data 目录”的迁移脚本。
