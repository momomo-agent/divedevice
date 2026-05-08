# DiveDevice

Web OS 壳 + Android 设备控制台，AI Native。

> Vite + Vue 3 · WebADB · agentic-core

## 快速上手

```bash
npm install
npm run dev           # http://localhost:5180
```

### 要求

- Chrome 或 Edge（WebUSB 支持）
- Android 设备开启 USB 调试
- 首次连接时浏览器会弹 WebUSB 授权，设备上点"允许"
- **生产环境必须 HTTPS**（WebUSB 限制）—— 走 Vercel / Cloudflare Pages / 自签证书本地均可

## 配置 Agent

- 右上角对话面板的 ⚙ 设置
- Provider：`anthropic` 或 `openai`（含 OpenAI 兼容端点）
- Base URL / Model / API Key 持久化到 localStorage
- 默认支持所有 app 贡献的 tools（fs / shell / editor / input / screen / …）

## 自定义 L1

想要 WebSocket 远程桥？想要"本地 shell 模式"？
只改 `src/transport/` 一个目录。L2 及以上不知道它在跟谁说话。

## 架构

```
src/
  transport/      L1 — WebADB 唯一入口
  device/         L2 — POSIX 风格门面（fs/shell/input/screen/app/logcat）
  services/       — app-registry / window-manager / device-hub / toolbus / eventbus / chat / agent / settings
  composables/    — app 从这里拿依赖（useDevice/useWindow/useChat…）
  apps/           L4 — 每个 app 一个目录（manifest + Window.vue）
  shell/          L5 — Dock / Desktop / ChatPanel / WindowFrame
  tools/          L3 — 预留（app 内联 tools 已汇入 toolbus）
  types/          跨层类型
```

### 三条硬规矩

1. App 之间**不直接 import**，协作走 toolbus / eventbus
2. App 只能拿到 L2 `device` 门面，看不到 adb
3. Tools 由 app 的 manifest 声明，启动时自动汇入 agent

### 新增一个 App

```
src/apps/your-app/
├── manifest.ts     # { id, name, icon, component, windowDefaults, requiresDevice, tools? }
└── Window.vue      # 用 useDevice() / useWindow() 拿上下文
```

然后在 `src/apps/index.ts` `appRegistry.register(...)` 一行。

## 内置 Apps

| 图标 | 名字 | 说明 |
|------|------|------|
| 📁 | Finder | 设备文件树，双击文件自动在 Editor 中打开（eventbus） |
| ⌨ | Terminal | xterm + shell-protocol `sh` |
| ✍ | Editor | Monaco，多 tab，Cmd+S 保存回设备 |
| 📱 | Screencast | 定时 `screencap -p` 拉帧 + tap/swipe/键盘映射 |
| 📸 | Screenshot | 一次性截图，复制/下载 |
| ⏺ | Recorder | Canvas + MediaRecorder 录 webm |
| 🪵 | Logcat | 实时日志流，级别/子串过滤 |

## 对话面板四位置切换

- 左 / 右 / 悬浮 / 隐藏
- `⌘J` 切换隐藏
- 隐藏时右下角浮钮唤起

## 快捷键

- `⌘J` 切换对话面板隐藏
- `⌘S` 保存当前 Editor tab

## 部署（Vercel）

```bash
npm install -g vercel
vercel --prod
```

`vercel.json` 已写好 SPA 回退规则。也可以走 Cloudflare Pages / Netlify / GitHub Pages（任何静态托管 + HTTPS）。

## 里程碑

- [x] Phase 1 — 分层架构 + Finder
- [x] Phase 2 — Terminal / Editor / Screencast / Screenshot / Recorder / Logcat
- [x] Phase 3 — agentic-core 接入 + 设置面板 + tool 流式可见
- [x] Phase 4 — USB 自动重连 + Chat FAB + 部署

## 已知限制

- Monaco 全量打包 4.3MB（未来考虑按语言懒加载）
- 现在 screencast 走 screencap 轮询，非 scrcpy，有延迟。L1 替换成 scrcpy 协议即可升级
- WebUSB 在 macOS 上某些线连不稳，断线会自动从 deviceHub 移除，重新点 🔌 授权即可
- 一个设备同时只能有一个 Adb session（浏览器 WebUSB 独占），跟 adb server 冲突时先 `adb kill-server`
