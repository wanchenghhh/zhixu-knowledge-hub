# 知序 · 企业知识中台

桌面 Web 前端与 FastAPI / LangChain 后端已接通，支持导入 → 解析预览 → 向量构建 → 混合检索与重排 → 流式问答 → 引用来源与日志。AIHubMix 已完成真实链路验证。

- [FastGPT 调研](docs/01-FastGPT调研.md)
- [已确认的 1.0 方案](docs/02-知识库中台1.0方案.md)
- [前端原型历史验收](docs/03-前端原型体验与验收.md)
- [后端运行、模型配置、Docker 部署与验收边界](docs/04-后端运行与联调.md)

本机入口：<http://127.0.0.1:8000>。管理员、知识库管理人员、使用者可切换；知识库、文件、检索、会话与日志由服务端按角色限制。当前无登录，适用于已确认的内部角色体验阶段。

## 快速运行

```bash
cd frontend
npm ci
npm run build
cd ../backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

默认使用 SQLite 与本地持久化任务，数据在 `backend/runtime/`。在模型服务中配置真实 API Key 并测试，凭证由后端加密。OCR 需单独配置阿里云 DocMind；不下载本地模型。

内网部署文件为 `compose.yaml`：Nginx + FastAPI + PostgreSQL / pgvector + Redis / Celery。需在根目录 `.env` 设置数据库密码和持久主密钥后运行 `docker compose up --build -d`，默认端口 8080。容器组合与并发压力尚待实际部署环境验收。

```bash
cd backend
.venv/bin/pytest -q
.venv/bin/ruff check app tests migrations
cd ../frontend
npm run build
npm test
```

4173 的独立前端原型仍使用演示数据，真实验收请使用 8000 入口。详细格式支持、限制、恢复与备份方法见运行文档。

## v1.1 云端真实 RAG

- [打开知识中台](https://zhixu-knowledge-hub-wan-cheng.vercel.app)
- [GitHub Pages 发布说明](https://wanchenghhh.github.io/zhixu-knowledge-hub/)
- [云端部署与验收](docs/06-v1.1云端真实RAG.md)

Vercel 同域提供桌面 Web 与 FastAPI / LangChain API；Neon PostgreSQL / pgvector 保存业务数据和向量；私有 Blob 保存原文件；Vercel Queues 驱动解析和构建任务。线上仅使用真实后端，连接失败显示错误。

按产品要求公开免登录，访客可自由切换三角色并使用已配置模型；角色控制用于业务体验，不能当作身份认证。模型密钥仅由后端加密保存，不进入源码或前端包。图片、扫描 PDF 和增强表格解析需要在解析设置中另配阿里云 DocMind 云端 API。

内网 Docker 版本继续使用同一后端与 Redis / Celery，原有本机数据不自动迁移；本次仅将已有三类模型配置加密迁移至云端。

## v1.2 元数据与多场景应用

新增自动元数据抽取、依据与人工修正、多策略切分及父子检索、辅助问题索引、文档有效版本与历史检索，以及独立的客服/报告应用。报告支持大纲确认、分章节检索撰写、任务恢复和 Word / Markdown 导出。

详见 [v1.2 后端与云端验收](docs/08-v1.2后端与云端验收.md)。进入知识库的“智能导入与加工”或左侧“应用中心”使用。新增能力接入真实服务端；旧资料通过明确的升级操作重新处理。
