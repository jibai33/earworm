# 闻曲 Earworm

> 听曲知雅意，旋律成耳虫。

闻曲是一款国风沉浸式音乐播放器（Web / PWA），墨青底色、琥珀暖光、朱砂印章——把每日推荐、歌单曲库、歌词舞台和氛围粒子装进一个安静的东方界面。

衍生自 [Mineradio](https://github.com/XxHuberrr/Mineradio-paused)（GPL-3.0），本项目遵循同一协议开源。

## 特性

- **发现**：每日推荐主卡、「日日新」横滑新曲、「拾遗」歌单网格，随机诗词点缀
- **搜曲**：网易云全库搜索、搜索历史；空查询时按你的收听 / 搜索 / 浏览记录生成「知音」个性化推荐
- **跨端画像**：Web / macOS / iOS 通过同一服务地址 + 同一同步码共用一份听感画像（见文末契约）
- **曲库**：我的歌单列表、歌单详情、整单播放
- **播放页**：氛围粒子、歌词舞台（双语、点击跳转）、逐行卡拉高亮、红心收藏
- **播放控制**：顺序 / 单曲循环 / 随机、播放队列抽屉、音质徽章（标准 / Hi-Res / 无损）
- **登录**：网易云扫码登录，cookie 本机持久化
- **PWA**：手机浏览器「添加到主屏幕」即是独立 App（iOS / Android 均可）

## 快速开始

```bash
npm install
npm start          # http://localhost:3210/app/
```

环境变量：`PORT`（默认 3210）、`HOST`（默认 0.0.0.0，局域网可访问）。

手机访问：连同一 Wi-Fi，浏览器打开 `http://<电脑IP>:3210/app/`。

## 项目结构

```
server.js      独立轻量服务端（网易云接口 + 静态资源）
web/           PWA 前端（原生 HTML/CSS/JS，无框架）
.cookie        登录 cookie（本机生成，勿提交）
```

## 声明

本项目不隶属于网易云音乐，平台接口仅用于个人学习与自有账号的播放辅助，请遵守对应平台的用户协议与版权规则。

## 跨端画像契约（Web / macOS / iOS 共用）

画像不绑定任何平台 SDK，是一组纯 HTTP JSON 接口。规则很简单：

> **同一个服务地址 + 同一枚同步码 = 同一份画像。**

Web 端已完整实现；macOS / iOS 原生端只需照下面契约接入，无须改动服务端。

### 身份

| 项 | 说明 |
| --- | --- |
| 同步码 `syncKey` | 形如 `EW-7KQ2-M9XR-4T8P`，服务端归一化后为 12 位大写字母数字。首次启动由 `/api/taste/bootstrap` 自动发放 |
| 设备 ID `deviceId` | 每个端自己生成并持久化（UUID 即可），只用于去重与来源标记 |
| 平台 `platform` | 自由字符串。Web 端自动区分 `web` / `ios-pwa` / `android-pwa`；原生端建议传 `macos` / `ios`，用于展示「几台设备共用」 |

事件 `id` 由客户端生成；服务端按 `id` 去重，因此**离线重放、多端同时上报都是安全的**。

### 事件 schema

```json
{
  "syncKey": "EW-7KQ2-M9XR-4T8P",
  "deviceId": "A1B2C3D4",
  "platform": "macos",
  "events": [
    {
      "id": "9f1c...",
      "type": "play",
      "ts": 1794043000000,
      "song": { "id": "2668397359", "name": "云烟成雨", "artist": "房东的猫", "provider": "netease", "cover": "" },
      "meta": { "keyword": "", "context": "", "duration": 246 }
    }
  ]
}
```

`type` 取值：`play` / `complete`（播完）/ `skip`（30% 前切走）/ `search` / `view`（歌单或详情停留）/ `like` / `unlike`。
搜索事件把关键词放 `meta.keyword`；浏览事件把歌单名放 `meta.context`。

### 接口

全部位于服务地址下，支持跨域；`syncKey` 可放在 query 或 POST body。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/taste/bootstrap` | 无 `syncKey` 时发放新码；返回 `syncKey` + `profile` + `recommendations` |
| POST | `/api/taste/events` | 批量上报（单次 ≤ 200 条），返回 `accepted` / `deduped` |
| GET | `/api/taste/events?since=<ts>` | 增量拉取其它设备新产生的事件 |
| GET | `/api/taste/profile` | 画像摘要、设备列表、隐私设置 |
| GET | `/api/taste/recommend?variant=0` | 生成推荐；`variant` 递增即「换一批」 |
| POST | `/api/taste/settings` | `{ "settings": { "enabled": false } }` 等 |
| POST | `/api/taste/feedback` | `{ "kind": "song", "value": "曲名", "action": "dislike" }` |
| POST | `/api/taste/sync-key` | `mode: "create"` 换码；`mode: "bind"` + `targetKey` 把两台设备的画像合并 |
| GET | `/api/taste/export` | 导出全部画像与事件 |
| POST | `/api/taste/clear` | 清除记录（不可恢复） |

`GET /api/taste/recommend` 返回 `status`（`ready` / `cold_start` / `disabled`）、`signals`（依据 chips）、`radio`（私人电台曲目）、`cards`（三张行为卡）、`suggestions`（带 `reason` 的曲目清单）、`trace`（可解释依据）、`history`。

### 原生端接入示例（Swift 片段）

```swift
let body: [String: Any] = [
    "syncKey": syncKey, "deviceId": deviceId, "platform": "ios",
    "events": [["id": UUID().uuidString, "type": "play", "ts": Int(Date().timeIntervalSince1970 * 1000),
                "song": ["id": id, "name": name, "artist": artist, "provider": "netease"]]]
]
var req = URLRequest(url: URL(string: baseURL + "/api/taste/events")!)
req.httpMethod = "POST"
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
req.httpBody = try JSONSerialization.data(withJSONObject: body)
URLSession.shared.dataTask(with: req).resume()
```

`baseURL` 与 Web 端 `localStorage.ew_api` 填同一个地址；同步码在「偏好设置」里复制后填到另一端并调用 `sync-key` 绑定即可完成合并。

### 权重与隐私

- 收听 50% / 搜索 30% / 浏览 20%；30 天滑动窗口，近 7 天事件 ×1.6 加权；跳过为负信号。
- 少于 10 条记录时返回 `cold_start`，先给风格选择，不假装了解你。
- 记录写在服务端 `data/taste-profiles.json`（已加入 `.gitignore`），不上传第三方、不跨应用共享。
- 关闭个性化后所有端立即停止采集，推荐返回 `disabled`，只保留搜索历史；可随时导出或清除。
- 前端 `web/taste.js` 是平台无关采集客户端，WKWebView 可直接加载；`web/taste-ui.js` 才是 Web 页面渲染层，原生端不需要它。

> 部署提醒：GitHub Pages 只是静态托管，共用画像需要一个常驻的 `node server.js` 可被各端访问。把 `ew_api`（Web）或 `baseURL`（原生）指向同一台已部署服务即可；若该服务未提供 `/api/taste/*`，前端会明确提示「连不上画像服务」，不会静默假装推荐成功。

## 许可

GPL-3.0，详见 [LICENSE](LICENSE)。
