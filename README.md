# PULSEBOX · 体感节奏拳击

摄像头识别骨架，平滑驱动 3D 小人；跟着原创短曲挥拳，击中左右滑入光圈的音符。没有摄像头时也能用 **A / L** 键试玩。旧版 Python 打地鼠游戏保存在 `legacy-python/`。

## 启动

需要 Node.js 20.19+ 或 22.12+，推荐当前 LTS 版本。Windows 可双击 **启动游戏.bat**，或在终端运行：

```powershell
npm install
npm run dev
```

打开终端显示的本地地址（通常是 `http://127.0.0.1:5173/`）。点击「开启摄像头」并允许浏览器使用摄像头；选择设备后可调整追踪帧率、骨架平滑和出拳灵敏度。点击「开始演奏」后会先倒数，再播放约 18 秒的节奏。音符进入左右光圈时朝对应方向出拳，屏幕镜像与真人动作一致。摄像头画面仅在本机处理。

## 开发与验证

```powershell
npm test
npm run build
npm run preview
```

技术栈：Vite、TypeScript、Three.js、MediaPipe Pose Landmarker、Web Audio API。姿态模型放在 `public/models/`；MediaPipe WASM 在 `npm install` 时从依赖包复制到 `public/wasm/`。构建结果在 `dist/`。部署时须把整个 `dist/` 放到 HTTPS 站点，摄像头权限在 HTTPS 或 localhost 下可用。

代码结构与换电脑继续开发的细节见 [HANDOFF.md](HANDOFF.md)。
