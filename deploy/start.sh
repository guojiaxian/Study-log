#!/usr/bin/env bash
#
# 启动学习记录服务（自适应，防重复启动）
# 探测顺序：
#   0. 服务已在响应（健康检查通过）            → 直接返回，不重复启动
#   1. systemd 单元 studylog 存在              → systemctl start
#   2. 其他环境（如开发机 nohup 模式）         → studylog.sh start
# 启动前若发现「工作目录 = 项目根」的残留服务进程，先中止并提示，避免端口冲突。
#
# 用法：deploy/start.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SERVICE="${STUDYLOG_SERVICE:-studylog}"

env_value() { [ -f "$ROOT/.env" ] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -1; }
PORT="$(env_value PORT)"; PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:$PORT/api/v1/health"
health_ok() { curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; }

# 与 stop.sh 相同的进程识别：命令行含入口 + 工作目录是本项目根
stray_pids() {
  local pid cwd
  for pid in $(pgrep -f "server/src/server\.js" 2>/dev/null); do
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || continue
    [ "$cwd" = "$ROOT" ] && printf '%s\n' "$pid"
  done
}

# 0) 已在运行
if health_ok; then
  echo "服务已在运行（$HEALTH_URL 健康检查通过），无需启动"
  exit 0
fi

pids="$(stray_pids)"
if [ -n "$pids" ]; then
  echo "错误：发现服务进程（PID：$pids）但健康检查未通过，疑似僵死或端口被占。" >&2
  echo "请先执行 deploy/stop.sh 清理后再启动；如仍失败请查看 logs/app.log 或 journalctl -u $SERVICE。" >&2
  exit 1
fi

# 1) systemd（unit 存在即走 systemctl，无论是否启用）
if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE" >/dev/null 2>&1; then
  echo "==> systemctl start $SERVICE"
  systemctl start "$SERVICE" || exit 1
else
  echo "==> ./studylog.sh start"
  "$ROOT/studylog.sh" start || exit 1
fi

# 健康检查
for _ in $(seq 1 20); do
  if health_ok; then
    echo "健康检查通过：$HEALTH_URL"
    exit 0
  fi
  sleep 1
done
echo "警告：已发出启动命令，但 $HEALTH_URL 未就绪，请查看 logs/app.log 或 journalctl -u $SERVICE" >&2
exit 1
