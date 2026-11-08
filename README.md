# 闻曲 Earworm

> 听曲知雅意，旋律成耳虫。

一个账号接通四个平台（网易云 / QQ 音乐 / 汽水音乐 / 小宇宙），一次登录后不必来回切平台，音源与信息在一处汇聚。

本仓库按端分目录：

```
earworm/
├── version_web/     Web / PWA 端（静态前端 + server.js 本地服务）   → 见 version_web/README.md
└── version_mac/     macOS 桌面端（Electron 壳 + 本地音源服务）       → 见 version_mac/README.md
```

## 两端的关系

| | version_web | version_mac |
| --- | --- | --- |
| 形态 | 浏览器页面 / 可添加到主屏幕的 PWA | 原生窗口的 macOS App（dmg / zip） |
| 运行方式 | `npm start` → `http://localhost:3210/app/` | `npm start` 起 Electron，内嵌本地服务 |
| 后端 | `server.js` 单文件 HTTP 服务 | `app/server.js`，与 web 端同源 |
| 仓库 | 本仓库（`jibai33/earworm`） | 独立仓库 `jibai33/earworm_mac`，在本目录内被 .gitignore 排除 |

两端共用同一套「统一音源层」接口（`/api/unified/*`）与同一份听感画像契约：同一服务地址 + 同一同步码 = 同一份画像，所以 Web 与 Mac 的收听习惯可以互通。

## 快速开始

```bash
# Web 端
cd version_web && npm install && npm start     # http://localhost:3210/app/

# macOS 端
cd version_mac && npm install && npm start     # Electron 窗口
```

在线版（仅静态前端，后端需另行部署）：https://jibai33.github.io/earworm/

## 声明

本项目不隶属于任何音乐平台，平台接口仅用于个人学习与自有账号的播放辅助，请遵守对应平台的用户协议与版权规则。衍生自 [Mineradio](https://github.com/XxHuberrr/Mineradio-paused)，遵循 GPL-3.0。
