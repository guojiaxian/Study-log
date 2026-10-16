#!/usr/bin/env bash
# StudyLog 部署脚本（裸机 + systemd）
# 由 Fastify 单进程同时提供 /api/v1 接口与 web/dist 静态页，故部署只需「更新代码 + 重启服务」。
# 流程：拉取代码 → 安装依赖 → 构建前端 → 重启 systemd → 健康检查
#
# 服务器一次性准备（只需做一次，root 身份）：
#   git clone git@github.com:guojiaxian/Study-log.git /root/studylog
#   cd /root/studylog && cp .env.example .env   # 填入 AI_API_KEY，并 chmod 600 .env
#   mkdir -p /root/studylog/logs
#   cp /root/studylog/deploy/studylog.service /etc/systemd/system/studylog.service
#   systemctl daemon-reload && systemctl enable --now studylog
#
# 之后每次发版：在服务器上执行  bash deploy/deploy.sh
#
# 前置条件：Node >= 22.5（node:sqlite 需要）、npm、git、curl
set -euo pipefail

APP_DIR="${APP_DIR:-/root/studylog}"
SERVICE="${SERVICE:-studylog}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"

# 以 root 运行时直接调用 systemctl，避免精简镜像未装 sudo 导致中断
if [ "$(id -u)" -eq 0 ]; then SYSTEMCTL=(systemctl); else SYSTEMCTL=(sudo systemctl); fi

# Node 版本硬约束：node:sqlite 自 22.5.0 起提供，低于此版本服务无法启动
read -r major minor < <(node -p 'process.versions.node.split(".").slice(0,2).map(Number).join(" ")')
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 5 ]; }; then
  echo "错误：需要 Node >= 22.5，当前为 $(node -v)" >&2
  exit 1
fi

cd "$APP_DIR"

# data/logs/backups 均被 .gitignore 排除，不会被下面的清理动作波及
mkdir -p data logs backups

echo "==> 拉取 origin/$BRANCH"
git fetch --prune origin
# 服务器工作区只用于运行，不接受手工改动：直接对齐远端，避免合并冲突
git checkout -f "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd

echo "==> 安装依赖"
npm --prefix server ci --omit=dev
npm --prefix web ci                 # 服务器上构建前端需要 vite，因此同时安装 devDependencies

echo "==> 构建前端"
npm --prefix web run build

echo "==> 重启服务（数据库迁移在进程启动时自动执行）"
"${SYSTEMCTL[@]}" restart "$SERVICE"

echo "==> 健康检查 $HEALTH_URL"
for _ in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "部署完成："
    curl -fsS "$HEALTH_URL"; echo
    exit 0
  fi
  sleep 1
done

echo "健康检查失败，请查看日志：journalctl -u $SERVICE -n 50 --no-pager" >&2
exit 1
