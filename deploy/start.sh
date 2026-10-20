#!/usr/bin/env bash
#
# 启动学习记录服务（自动适配运行模式）
#   - 服务器（systemd 单元 studylog 存在）→ systemctl start studylog
#   - 其他环境（如开发机 nohup 模式）     → 调用项目根目录 studylog.sh start
#
# 用法：deploy/start.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SERVICE="${STUDYLOG_SERVICE:-studylog}"

has_systemd_unit() {
  command -v systemctl >/dev/null 2>&1 \
    && systemctl list-unit-files 2>/dev/null | grep -q "^$SERVICE\.service"
}

if has_systemd_unit; then
  if systemctl is-active --quiet "$SERVICE"; then
    echo "服务已在运行（systemd: $SERVICE）"
  else
    echo "==> systemctl start $SERVICE"
    systemctl start "$SERVICE" || exit 1
  fi
else
  echo "==> ./studylog.sh start"
  "$ROOT/studylog.sh" start || exit 1
fi

# 健康检查
env_value() { [ -f "$ROOT/.env" ] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -1; }
PORT="$(env_value PORT)"; PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:$PORT/api/v1/health"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "健康检查通过：$HEALTH_URL"
    exit 0
  fi
  sleep 1
done
echo "警告：服务已发出启动命令，但 $HEALTH_URL 未就绪，请查看日志排查" >&2
exit 1
