# 开发交接：PULSEBOX

## 换电脑继续开发

```powershell
git clone https://github.com/gray5508/my_game.git
cd my_game
npm install
npm run dev
```

Node.js 版本须满足 Vite 8：20.19+ 或 22.12+。在浏览器打开终端显示的本地地址。`npm install` 的后置脚本把依赖包内的 MediaPipe WASM 复制到 `public/wasm/`；该目录不入 Git。姿态模型 `public/models/pose_landmarker_lite.task` 入 Git，因此另一台电脑无需运行时下载模型。正式部署运行 `npm run build`，部署整个 `dist/`；摄像头页面需处于 HTTPS 或 localhost。

## 项目结构

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | UI 状态、摄像头选择与采集、输入判定、游戏流程 |
| `public/pose-worker.js` | 在传统 Web Worker 中加载 MediaPipe 并处理摄像头帧；库的 WASM 加载器依赖 `importScripts` |
| `src/logic.js` | 谱面、计分、出拳判定、骨架指数平滑；可直接用 Node 测试 |
| `src/stage.ts` | Three.js 场景、3D 小人、音符、光圈与命中粒子 |
| `src/audio.ts` | Web Audio 合成原创鼓点、低音、旋律和命中音效 |
| `src/style.css`、`index.html` | 页面布局、控件和 HUD |
| `tests/logic.test.mjs` | 规则、平滑和出拳判定测试 |
| `legacy-python/` | 旧版 Tkinter 打地鼠游戏，非当前主入口 |

## 关键数据流

1. 用户打开摄像头；主线程按所选 FPS 从 `<video>` 创建 `ImageBitmap`，传给 Worker。Worker 推理后返回 33 个人体关键点。识别期间不会把视频传到网络。
2. `PoseSmoother` 对可见关键点做按时间间隔计算权重的指数平滑；`Stage` 将肩、肘、腕、髋、腿等点映射到小人，再在每帧插值，渲染保持流畅。小人失去追踪后回到待机姿势。
3. 出拳判定使用**未平滑的手腕点**，检查左右区域、向外或朝镜头的位移速度与冷却时间；用平滑点判定会损失快速出拳信息。
4. `RhythmSession` 用 `performance.now()` 计时，目标音符进入判定窗时接收出拳。音乐由 Web Audio 在开始时按同一倒数时间预排程。判定窗为 ±220 ms，±85 ms 为 PERFECT。

## 调整玩法

- 谱面和节奏：`src/logic.js` 的 `bars`、`BPM`、`TRAVEL`、`WINDOW`。`bars` 每个字符代表半拍，`L/R` 为左右音符，`.` 为空拍。
- 音色：`src/audio.ts` 的 `schedule()`；目前是 8 小节、108 BPM 的原创短曲。
- 出拳区域和阈值：`src/logic.js` 的 `PunchDetector`；界面灵敏度滑杆修改速度阈值。
- 小人与特效：`src/stage.ts` 的 `makeRig()`、`rigPoints()`、`makeNote()`、`hit()`。
- 摄像头性能：`src/main.ts` 的采集节流、Worker 往返；优先检查实际摄像头 FPS 和推理耗时，再增加复杂特效。

## 验证与已知边界

运行 `npm test` 和 `npm run build`。应再用实际摄像头检查：镜像方向、左右命中、不同身高与光线、帧率稳定性、音画同步及浏览器权限。本次开发环境没有可用摄像头，因此这些动作仍需在有设备的电脑上确认。当前识别的是人体姿态中的手腕，不判断是否真正握拳；强遮挡和过快动作可能丢点。没有摄像头时用 **A / L** 键完成整首歌的交互检查。
