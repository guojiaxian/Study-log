#!/usr/bin/env bash
#
# 停止学习记录服务（自适应，健壮版）
# 探测顺序：
#   1. systemd 单元 studylog 处于运行中        → systemctl stop
#   2. PID 文件记录的进程（nohup 模式）        → studylog.sh stop
#   3. 兜底：扫描「工作目录 = 本项目根」的服务进程（手动 nohup、丢 PID 文件都能停掉）
#
# 用法：deploy/stop.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SERVICE="${STUDYLOG_SERVICE:-studylog}"
STOP_TIMEOUT=15

# 服务进程的精确识别：命令行含入口文件，且进程工作目录是本项目根
# （启动时 cd 到项目根以相对路径运行，因此不能只匹配命令行，否则会误杀别的项目）
stray_pids() {
  local pid cwd
  for pid in $(pgrep -f "server/src/server\.js" 2>/dev/null); do
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || continue
    [ "$cwd" = "$ROOT" ] && printf '%s\n' "$pid"
  done
}

kill_pids() {   # kill_pids PID... → 先 SIGTERM，超时 SIGKILL；有进程被杀返回 0
  [ $# -gt 0 ] || return 1
  echo "停止进程：$*"
  kill -TERM "$@" 2>/dev/null
  local i
  for i in $(seq 1 $((STOP_TIMEOUT * 2))); do
    sleep 0.5
    pgrep -f "server/src/server\.js" >/dev/null 2>&1 || { echo "已停止"; return 0; }
  done
  echo "优雅退出超时，改用 SIGKILL…"
  kill -KILL "$@" 2>/dev/null
  sleep 1
  echo "已强制停止"
  return 0
}

stopped=0

# 1) systemd
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  echo "==> systemctl stop $SERVICE"
  systemctl stop "$SERVICE" || exit 1
  echo "已停止（systemd: $SERVICE）"
  stopped=1
fi

# 2) PID 文件
if [ "$stopped" -eq 0 ] && "$ROOT/studylog.sh" stop 2>/dev/null | grep -q "已停止\|已强制停止"; then
  stopped=1
fi

# 3) 兜底扫描残留进程（含 systemd 停止后仍存活的孤儿进程）
if pids="$(stray_pids)" && [ -n "$pids" ]; then
  [ "$stopped" -eq 1 ] && echo "发现残留进程，继续清理…"
  kill_pids $pids
  stopped=1
fi

[ "$stopped" -eq 1 ] || echo "服务未在运行（systemd 无活跃单元，也未发现服务进程）"
