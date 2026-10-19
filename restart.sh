#!/usr/bin/env bash
#
# 学习记录（StudyLog）重启脚本
#
#   ./restart.sh              构建前端 + 重启服务 + 健康检查
#   ./restart.sh --no-build   跳过后端代码改动场景下的前端构建，直接重启
#
# 说明：
#   Fastify 单进程同时提供 /api/v1 接口与 web/dist 静态页，前端改动必须重新构建才会生效，
#   因此默认先构建再重启；仅改了服务端代码时用 --no-build 可以更快。
#   进程管理复用 ./studylog.sh（PID 文件驱动）；若检测到服务由 systemd 托管，则改用 systemctl。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

SERVICE="studylog"

env_value() {   # 从 .env 取键值（去掉引号与空白）
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" \
    | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/[[:space:]]*$//'
}

PORT="$(env_value PORT)"; PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:$PORT/api/v1/health"

usage() {
  cat <<'EOF'
学习记录 重启脚本

用法：./restart.sh [--no-build]

  （无参数）   构建前端 → 重启服务 → 健康检查
  --no-build   跳过前端构建，直接重启（仅适用于只改服务端代码）
  -h, --help   显示本帮助
EOF
}

health_check() {
  command -v curl >/dev/null 2>&1 || { echo "（未安装 curl，跳过健康检查）"; return 0; }
  local i
  for i in $(seq 1 20); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "健康检查通过："
      curl -fsS "$HEALTH_URL"; echo
      return 0
    fi
    sleep 1
  done
  echo "健康检查失败（$HEALTH_URL 无响应），请查看日志：./studylog.sh log 50" >&2
  return 1
}

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build|-n) BUILD=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg" >&2; echo; usage; exit 2 ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  echo "==> 构建前端"
  npm run build --prefix web || { echo "前端构建失败，已中止重启（服务保持原状）" >&2; exit 1; }
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  echo "==> 检测到 systemd 托管的 $SERVICE 服务，改用 systemctl restart"
  systemctl restart "$SERVICE" || exit 1
else
  echo "==> 重启服务（./studylog.sh）"
  [ -x "$ROOT/studylog.sh" ] || { echo "错误：缺少可执行的 studylog.sh" >&2; exit 1; }
  "$ROOT/studylog.sh" restart || exit 1
fi

echo "==> 健康检查 $HEALTH_URL"
health_check
