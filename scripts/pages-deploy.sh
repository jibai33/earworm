#!/usr/bin/env bash
# 把 web/ 静态快照同步到 gh-pages 分支（GitHub Pages 在线版）
# 用法：npm run pages
#
# 说明：main 是源码 + server.js 后端；gh-pages 分支只放 web/ 的静态文件，
# GitHub Pages 从该分支根目录发布。本脚本用临时 detached worktree 操作，
# 不切换主工作区分支、不改动 main、无变化时不产生空提交。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v rsync >/dev/null 2>&1; then
  echo "缺少 rsync，无法同步" >&2
  exit 1
fi

git fetch origin gh-pages >/dev/null 2>&1 || {
  echo "无法从 origin 拉取 gh-pages，请检查网络/代理" >&2
  exit 1
}

TMP="$(mktemp -d /tmp/earworm-pages.XXXXXX)"
WT="$TMP/wt"
cleanup() {
  # 先把 cwd 挪出临时目录，否则删除后 shell 退出时会报 getcwd 失败
  cd "$ROOT" 2>/dev/null || cd / || true
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

git worktree add --detach "$WT" origin/gh-pages >/dev/null
# --delete 清理线上已废弃的旧文件；.git 在 worktree 里是链接文件，必须排除
rsync -a --delete --exclude='.git' "$ROOT/web/" "$WT/"

cd "$WT"
git add -A
if git diff --cached --quiet; then
  echo "在线版已是最新，无需部署。"
  exit 0
fi

git commit -q -m "deploy(pages): 同步 web 静态快照 @ $(git -C "$ROOT" rev-parse --short HEAD)"
git push origin HEAD:gh-pages
echo "已推送 gh-pages。GitHub Pages 通常 1–2 分钟内生效：https://jibai33.github.io/earworm/"
