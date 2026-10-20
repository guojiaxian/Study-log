#!/usr/bin/env bash
#
# 停止学习记录服务（自动适配运行模式）
#   - 服务器（systemd 单元 studylog 存在）→ systemctl stop studylog
#   - 其他环境（如开发机 nohup 模式）     → 调用项目根目录 studylog.sh stop
#
# 用法：deploy/stop.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SERVICE="${STUDYLOG_SERVICE:-studylog}"

if command -v systemctl >/dev/null 2>&1 \
  && systemctl list-unit-files 2>/dev/null | grep -q "^$SERVICE\.service"; then
  if systemctl is-active --quiet "$SERVICE"; then
    echo "==> systemctl stop $SERVICE"
    systemctl stop "$SERVICE" || exit 1
    echo "已停止"
  else
    echo "服务未在运行（systemd: $SERVICE）"
  fi
else
  echo "==> ./studylog.sh stop"
  "$ROOT/studylog.sh" stop || exit 1
fi
