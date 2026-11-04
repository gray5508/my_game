# 开发交接

## 在另一台电脑启动

```powershell
git clone https://github.com/gray5508/my_game.git
cd my_game
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Windows 也可以在安装 Python 3.10+ 后直接双击 `启动游戏.bat`。首次启动游戏时会从 Google 下载约 5.8 MB 的姿态模型到 `models/pose_landmarker_lite.task`；模型文件和 `.venv` 都不进 Git，换电脑后会重新生成。需要给 Python 开启系统摄像头权限。

本机验证使用 Python 3.13、MediaPipe 1.2.2、OpenCV contrib 5.0、Pillow 12.3。其他系统可用自己的 Python 虚拟环境安装 `requirements.txt` 后运行 `python app.py`，但尚未在 macOS/Linux 验证。

## 代码入口与数据流

| 文件 | 职责 |
| --- | --- |
| `app.py` | Tkinter GUI、摄像头选择、后台采集线程、画面与骨架绘制、游戏控制 |
| `tracker.py` | OpenCV 读帧后的 MediaPipe 姿态推理；返回镜像 RGB 画面、双手腕坐标、骨架线段 |
| `game.py` | 地鼠位置、计时、出拳命中、分数；`GAMES` 注册表 |
| `test_game.py` | 不依赖摄像头的命中与暂停规则测试 |

摄像头帧由后台线程读取、镜像并送入姿态模型。肩、肘、腕等关键点坐标以 `0..1` 表示；GUI 将坐标乘以画布宽高绘制。游戏只接收左右手腕位置与时间戳，不接触摄像头。每帧计算手腕平面速度或朝向摄像头的深度速度；速度超过灵敏度阈值、位置进入地鼠范围且冷却结束时得分。停在地鼠上的手不会持续得分。

## 继续开发小游戏

新游戏类注册到 `game.py` 的 `GAMES` 后会自动出现在 GUI 下拉框。当前界面期待游戏类支持：

- 构造参数 `mole_seconds`、`punch_speed`；属性 `title`、`score`、`misses`、`started`、`finished`、`paused_at`、`previous`。
- `start(now)`、`update(wrists, now)`、`pause(now)`、`resume(now)`、`remaining(now)`、`draw(canvas, width, height)`。

这套接口目前为第一款游戏服务。加入玩法差异较大的第二款游戏时，建议先把 `app.py` 中的游戏专属参数和状态文字移到游戏类，由注册表提供每款游戏的设置项；摄像头与追踪层可以继续复用。

## 验证与已知边界

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_game.py
.\.venv\Scripts\python.exe -m py_compile app.py game.py tracker.py
```

已验证规则测试、空白帧上的姿态模型推理、GUI 创建与启动。开发环境没有可用摄像头，因此真实人体识别、不同摄像头和出拳手感仍需在有摄像头的电脑上实测。识别使用姿态模型的手腕点，并不判断手是否握拳；遮挡、弱光、手腕短暂丢失会影响命中。目标帧率是上限，实际帧率由设备性能决定。

Windows 中文目录下 MediaPipe 的原生模型路径加载会失败，因此 `tracker.py` 从内存读取模型。部分 Windows 虚拟环境找不到 Tcl 路径，`app.py` 会尝试使用 Python 安装目录内的 Tcl/Tk；若安装本身缺失 Tcl/Tk，需修复 Python 安装。
