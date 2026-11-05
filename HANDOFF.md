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

| 文件                          | 职责                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `src/main.ts`                 | UI 状态、摄像头选择与采集、输入判定、游戏流程                                           |
| `public/pose-worker.js`       | 在传统 Web Worker 中加载 MediaPipe 并处理摄像头帧；库的 WASM 加载器依赖 `importScripts` |
| `src/logic.js`                | 谱面、计分、出拳判定、骨架指数平滑；可直接用 Node 测试                                  |
| `src/stage.ts`                | Three.js 场景、前方双轨道、光圈与命中粒子；角色网格目前隐藏                             |
| `src/audio.ts`                | Web Audio 合成原创鼓点、低音、旋律和命中音效                                            |
| `src/style.css`、`index.html` | 页面布局、控件和 HUD                                                                    |
| `tests/logic.test.mjs`        | 规则、平滑和出拳判定测试                                                                |
| `legacy-python/`              | 旧版 Tkinter 打地鼠游戏，非当前主入口                                                   |

## 关键数据流

1. 页面加载后默认请求摄像头，默认目标帧率 30 FPS；主线程按所选 FPS 从 `<video>` 创建 `ImageBitmap`，传给 Worker。Worker 推理后返回 33 个人体关键点。识别期间不会把视频传到网络。
2. `PoseSmoother` 对可见关键点做按时间间隔计算权重的指数平滑。`mapPoseToWorld()` 把正对用户的摄像头坐标转换成游戏世界坐标：镜像 X 轴保持左右手一致，Y 轴向上，负 Z 轴指向游戏前方。当前不显示角色，虚拟相机从原角色位置后上方看向前方双轨道；世界坐标用于挥拳反馈的位置。
3. 出拳使用**未平滑的手腕和手肘点**：`relativeWrist()` 将手腕相对肩膀的位移按肩宽归一化，`PunchDetector` 再综合向外/向前位移和手臂伸直幅度，减少站位远近的影响并排除单纯的侧向挥手。触发后要先收拳再允许下一次，避免一拳重复计数。光圈只作节拍提示，**不参与碰撞门槛**。得分时光圈放大并从光圈位置散开粒子。游戏画面只显示得分，其他文字提示已隐藏；浏览器错误仍会显示。
4. `RhythmSession` 用 `performance.now()` 计时，目标音符进入判定窗时接收出拳。摄像头出拳使用**采集帧时间**，并给推理返回留 180 ms 的结算缓冲，避免识别耗时吞掉本来有效的一拳。音乐由 Web Audio 按同一节拍表预排程。判定窗为 ±270 ms，±85 ms 为 PERFECT。可勾选循环模式；一轮结束后自动开始下一轮、总分累计，逐轮加速至最多 1.3 倍；取消勾选后当前轮结束再停。

## 调整玩法

- 谱面和节奏：`src/logic.js` 的 `bars`、`beatTime()`、`BPM`、`LATE_SPEEDUP`、`TRAVEL`、`WINDOW`。`bars` 每个字符代表半拍，`L/R` 为左右音符，`.` 为空拍。当前 16 小节、32 个音符、约 34 秒；每侧连续两拳，后半段从 108 BPM 加速约 12%。
- 音色：`src/audio.ts` 的 `schedule()`；合成原创鼓点、低音与旋律，并使用同一 `beatTime()` 跟随加速。
- 出拳阈值：`src/logic.js` 的 `PunchDetector`；界面灵敏度滑杆修改速度阈值。左右映射由 MediaPipe 手腕编号 15/16 决定。
- 光圈与视角：`src/stage.ts` 的 `PAD_Z`、`targets`、`resize()`。光圈处于负 Z 位置；音符从更远处沿轨道向光圈移动。虚拟相机独立于骨架世界坐标。
- 特效与可选角色：`src/stage.ts` 的 `makeNote()`、`hit()`；命中时有双层冲击波、放大的粒子、短暂镜头震动和约 1.2 秒的余韵，音效在 `src/audio.ts` 的 `hit()`。循环模式下音符、粒子和冲击波过期后会释放 GPU 资源。`makeRig()` 的角色网格保留供以后玩法使用，当前 `rig.visible = false`。
- 摄像头性能：`src/main.ts` 的采集节流、Worker 往返；优先检查实际摄像头 FPS 和推理耗时，再增加复杂特效。

## 验证与已知边界

运行 `npm test` 和 `npm run build`。本机 UGREEN Camera 1080P 已能在浏览器中追踪骨架；首次录制的旧版回合为 0/32，画面显示光圈过远、区域重合门槛挡住挥拳，因此改成动作判定并重做视角。之前的实机回合曾显示 1600 分、53% 命中率；新版长曲和循环模式仍需实测手感，以及不同身高与光线、帧率稳定性和音画同步。诊断录屏在本机 `recordings/`，该目录被 Git 忽略，不随仓库上传。当前识别的是人体姿态，不判断是否真正握拳；强遮挡和过快动作可能丢点。没有摄像头时可用 **A / L** 键练习。
