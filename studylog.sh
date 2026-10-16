#!/usr/bin/env bash
#
# StudyLog 服务管理脚本（初中生学习成绩记录系统）
#
#   ./studylog.sh start        启动服务（后台常驻，日志写入 logs/app.log）
#   ./studylog.sh stop         停止服务（先发 SIGTERM 优雅退出，超时再 SIGKILL）
#   ./studylog.sh restart      重启服务
#   ./studylog.sh status       查看运行状态、PID、内存与健康检查结果
#   ./studylog.sh log [N]      查看最近 N 行日志（默认 50 行）
#
# 说明：
#   - 进程用 data/studylog.pid 记录，不使用 pkill 按名称匹配，避免误杀其它进程；
#   - .env 由应用自身加载（服务端 src/lib/loadEnv.js），本脚本只读取 PORT/HOST 用于健康检查；
#   - 与 deploy/studylog.service（systemd）二者选其一：用 systemd 时请改用 systemctl 管理本服务。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

ENTRY="server/src/server.js"
PID_FILE="$ROOT/data/studylog.pid"
LOG_FILE="$ROOT/logs/app.log"
STOP_TIMEOUT=15          # 优雅退出最长等待秒数

# ---------------------------------------------------------------- 配置读取

env_value() {   # env_value KEY  → 从 .env 取键值（去掉引号与空白）
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" \
    | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" -e 's/[[:space:]]*$//'
}

PORT="$(env_value PORT)"; PORT="${PORT:-3000}"
HOST="$(env_value HOST)"; HOST="${HOST:-0.0.0.0}"
case "$HOST" in 0.0.0.0|"::"|"") HEALTH_HOST="127.0.0.1" ;; *) HEALTH_HOST="$HOST" ;; esac
BASE_URL="http://$HEALTH_HOST:$PORT"
HEALTH_URL="$BASE_URL/api/v1/health"

# ---------------------------------------------------------------- 进程工具

read_pid() {    # 成功则输出 PID 字符串
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  [[ "${pid:-}" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

pid_alive() {   # pid_alive PID → 进程存在且命令行确为本项目入口
  local pid="$1"
  [ -n "$pid" ] && [ -d "/proc/$pid" ] || return 1
  grep -qa -- "$ENTRY" "/proc/$pid/cmdline" 2>/dev/null
}

current_pid() { # 输出存活进程的 PID；非存活则清理陈旧 PID 文件
  local pid
  pid="$(read_pid)" || return 1
  if pid_alive "$pid"; then printf '%s' "$pid"; return 0; fi
  rm -f "$PID_FILE"
  return 1
}

health_ok() {
  command -v curl >/dev/null 2>&1 || return 0   # 无 curl 时跳过探测，视为通过
  curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1
}

# ---------------------------------------------------------------- 子命令

start_service() {
  local pid
  if pid="$(current_pid)"; then
    echo "服务已在运行（PID $pid）"
    echo "  访问地址：$BASE_URL/"
    return 0
  fi

  command -v node >/dev/null 2>&1 || { echo "错误：未找到 node，请先安装 Node ≥ 22.5（依赖内置 node:sqlite）"; return 1; }
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' \
    || echo "警告：当前 Node 版本 $(node -v)，低于要求的 22.5，node:sqlite 可能不可用"
  [ -f "$ROOT/web/dist/index.html" ] \
    || echo "提示：未发现 web/dist/index.html，浏览器访问将无页面，请先执行 npm run build"

  mkdir -p "$ROOT/logs" "$ROOT/data"
  echo "启动中…（日志：logs/app.log）"
  nohup node --disable-warning=ExperimentalWarning "$ENTRY" >>"$LOG_FILE" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"

  local i
  for i in $(seq 1 40); do           # 最多等待约 20 秒
    sleep 0.5
    if ! pid_alive "$pid"; then
      echo "启动失败：进程已退出，最近日志："
      tail -n 20 "$LOG_FILE" 2>/dev/null
      rm -f "$PID_FILE"
      return 1
    fi
    if health_ok; then
      echo "启动成功（PID $pid）"
      echo "  访问地址：$BASE_URL/"
      return 0
    fi
  done
  echo "警告：进程仍在运行，但 $HEALTH_URL 在 20 秒内未响应，请用 './studylog.sh log' 排查"
  return 1
}

stop_service() {
  local pid
  if ! pid="$(current_pid)"; then
    echo "服务未在运行"
    return 0
  fi

  echo "停止中（PID $pid，先 SIGTERM 优雅退出）…"
  kill -TERM "$pid" 2>/dev/null

  local i
  for i in $(seq 1 $((STOP_TIMEOUT * 2))); do
    sleep 0.5
    if ! pid_alive "$pid"; then
      rm -f "$PID_FILE"
      echo "已停止"
      return 0
    fi
  done

  echo "优雅退出超时（${STOP_TIMEOUT}s），改用 SIGKILL…"
  kill -KILL "$pid" 2>/dev/null
  sleep 1
  if pid_alive "$pid"; then
    echo "错误：进程 $pid 未能终止，请手动处理"
    return 1
  fi
  rm -f "$PID_FILE"
  echo "已强制停止"
  return 0
}

restart_service() {
  stop_service || return 1
  sleep 1
  start_service
}

status_service() {
  local pid
  if ! pid="$(current_pid)"; then
    echo "状态：未运行"
    return 1
  fi

  echo "状态：运行中（PID $pid）"
  local rss
  rss="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ -n "$rss" ] && echo "常驻内存：$((rss / 1024)) MB"

  if command -v curl >/dev/null 2>&1; then
    local body
    if body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
      echo "健康检查：$body"
    else
      echo "健康检查：失败（$HEALTH_URL 无响应）"
      return 1
    fi
  fi

  echo "访问地址：$BASE_URL/"
  return 0
}

log_service() {
  local n="${1:-50}"
  [ -f "$LOG_FILE" ] || { echo "暂无日志文件（$LOG_FILE）"; return 1; }
  tail -n "$n" "$LOG_FILE"
}

usage() {
  cat <<'EOF'
StudyLog 服务管理脚本

用法：./studylog.sh <命令>

命令：
  start        启动服务（后台常驻，日志写入 logs/app.log）
  stop         停止服务（先 SIGTERM 优雅退出，超时再 SIGKILL）
  restart      重启服务
  status       查看运行状态、PID、内存与健康检查结果
  log [N]      查看最近 N 行日志（默认 50 行）
  help         显示本帮助

实时跟踪日志：tail -f logs/app.log
EOF
}

# ---------------------------------------------------------------- 入口

case "${1:-help}" in
  start)   start_service ;;
  stop)    stop_service ;;
  restart) restart_service ;;
  status)  status_service ;;
  log)     shift; log_service "${1:-50}" ;;
  help|-h|--help) usage ;;
  *) echo "未知命令：$1"; echo; usage; exit 2 ;;
esac
