#!/usr/bin/env bash
#
# 重启学习记录服务（自动适配运行模式）
#   - 服务器（systemd 单元 studylog 存在）→ systemctl restart studylog
#   - 其他环境（如开发机 nohup 模式）     → 调用项目根目录 studylog.sh restart
#
# 用法：deploy/restart.sh          仅重启服务（不构建前端）
#       deploy/restart.sh --build  先构建前端再重启（改了页面代码后用）
#
# 说明：项目根目录的 restart.sh 默认构建前端并重启，行为等价于 ./deploy/restart.sh --build。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
SERVICE="${STUDYLOG_SERVICE:-studylog}"

BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build|-b) BUILD=1 ;;
    -h|--help)
      sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  echo "==> 构建前端"
  npm run build --prefix "$ROOT/web" || { echo "前端构建失败，已中止重启（服务保持原状）" >&2; exit 1; }
fi

"$ROOT/deploy/stop.sh" || exit 1
sleep 1
"$ROOT/deploy/start.sh" || exit 1
