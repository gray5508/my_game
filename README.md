# 体感小游戏：拳击打地鼠

换电脑继续开发请看 [HANDOFF.md](HANDOFF.md)。

Windows 上双击 **启动游戏.bat**。脚本首次运行会创建 `.venv` 并安装依赖；游戏首次启动时会下载约 6 MB 的 MediaPipe 姿态模型。之后模型可离线使用。需要 Python 3.10 或更新版本、摄像头和网络（仅首次安装/下载）。

也可以手动运行：

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

1. 选择游戏、摄像头、目标帧率和难度，点击「开始游戏」。
2. 面向摄像头，让肩、肘和双手入镜；挥拳时用手腕处的红色圆点击中地鼠。
3. 每局 60 秒。快速挥拳并命中得 1 分；地鼠消失记 1 次漏掉。支持暂停、继续和结束。

识别在本机进行，摄像头画面不上传。目标帧率是处理上限，实际帧率取决于设备性能。摄像头打不开时，检查 Windows 摄像头权限，或关闭其他占用摄像头的软件。

新增小游戏时，在 `game.py` 里实现 `start / update / pause / resume / remaining / draw` 等方法，并注册到 `GAMES`；摄像头识别和界面可复用。

运行规则测试：`.\.venv\Scripts\python.exe -m unittest -v test_game.py`。
