# DiveDevice

Web OS 壳 + Android 设备控制台，AI Native。

> 💡 早期想法阶段 · Phase 1 通路验证中

## 技术栈

- Vite + Vue 3 Composition API + TypeScript
- `@yume-chan/adb` + WebUSB
- Pinia（按需）

## 运行

```bash
pnpm install   # 或 npm install
pnpm dev       # http://localhost:5180
```

需要 Chrome/Edge，设备开启 USB 调试。首次连接时浏览器会弹 WebUSB 授权。

## 分层架构

```
src/
  transport/   # L1 — WebADB 唯一入口
  device/      # L2 — POSIX 风格门面
  tools/       # L3 — agent tool schema
  apps/        # L4 — 每个 app 一个目录
    <app-id>/
      manifest.ts
      Window.vue
      store.ts   (可选)
      tools.ts   (可选)
  shell/       # L5 — Desktop / Dock / ChatPanel / WindowFrame
  services/    # 核心服务：app-registry / window-manager / device-hub / toolbus / eventbus / chat
  composables/ # app 只从这里拿依赖
```

### 三条硬规矩

1. App 之间**不直接 import**，协作走 toolbus / eventbus
2. App 只能拿到 L2 `device` 门面，**看不到 adb**
3. Tools 由 app 的 manifest 声明，自动汇入 agent

## 新增一个 App

```bash
src/apps/your-app/
├── manifest.ts     # 元数据 + tools
└── Window.vue      # 组件，useDevice() / useWindow() 拿上下文
```

然后在 `src/apps/index.ts` 注册一次。

## Phase 进度

- [x] Phase 1：通路验证（Finder ls）
- [ ] Phase 2：Terminal + Editor + Screencast
- [ ] Phase 3：接入 agentic-core
- [ ] Phase 4：Logcat / Recorder / Screenshot / 多设备切换打磨

详见 [设计定稿](/Users/kenefe/LOCAL/momo-agent/projects/divedevice-design.md)。
