# 在线版已停止部署

自 2026-11-16 起，本项目不再向 GitHub Pages 部署，静态站点已下线。

- 源码与完整开发记录保留在 `main` 分支的 `version_web/`。
- 本机运行方式见仓库根目录 README。
- 如需恢复：在仓库 Settings → Pages 重新启用服务，并在 `version_web/` 下显式执行
  `EARWORM_ALLOW_PAGES=1 npm run pages`（部署脚本默认已停用，需显式解锁）。

此分支仅保留本说明文件，不含任何应用静态资源。
