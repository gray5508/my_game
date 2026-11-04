"""Camera mini-game launcher. Run with: py app.py"""

import os
from pathlib import Path
import queue
import sys
import threading
import time

# Some Windows venv installations do not resolve the base Python Tcl directory.
_tcl_root = Path(sys.base_prefix) / "tcl"
if sys.platform == "win32" and (_tcl_root / "tcl8.6" / "init.tcl").exists():
    os.environ.setdefault("TCL_LIBRARY", str(_tcl_root / "tcl8.6"))
    os.environ.setdefault("TK_LIBRARY", str(_tcl_root / "tk8.6"))

import tkinter as tk
from tkinter import messagebox, ttk

import cv2
from PIL import Image, ImageTk

from game import GAMES
from tracker import PoseTracker


WIDTH, HEIGHT = 800, 600
BG = "#101827"
PANEL = "#1b2940"
WHITE = "#eff5ff"
MUTED = "#9db0cc"
ACCENT = "#f6b749"


class GameApp:
    def __init__(self, root):
        self.root = root
        root.title("体感小游戏 · 拳击打地鼠")
        root.configure(bg=BG)
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.events = queue.Queue(maxsize=3)
        self.stop_event = threading.Event()
        self.worker = None
        self.game = None
        self.photo = None
        self.last_frame_at = None
        self.actual_fps = 0
        self.flash_until = 0
        self.camera_var = tk.StringVar(value="摄像头 0")
        self.fps_var = tk.IntVar(value=20)
        self.game_var = tk.StringVar(value=next(iter(GAMES)))
        self.level_var = tk.StringVar(value="标准（1.4 秒）")
        self.speed_var = tk.DoubleVar(value=.75)
        self.score_var = tk.StringVar(value="0")
        self.miss_var = tk.StringVar(value="0")
        self.time_var = tk.StringVar(value="60 秒")
        self.status_var = tk.StringVar(value="准备就绪 · 站在摄像头前，让上半身和双手入镜")
        self._build_ui()
        self.root.after(30, self._poll)

    def _build_ui(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Dark.TCombobox", fieldbackground="#243650", background="#243650", foreground=WHITE, arrowcolor=WHITE)
        style.map("Dark.TCombobox", fieldbackground=[("readonly", "#243650")], foreground=[("readonly", WHITE)])
        top = tk.Frame(self.root, bg=BG, padx=22, pady=16)
        top.pack(fill="x")
        tk.Label(top, text="体感小游戏", font=("Microsoft YaHei UI", 21, "bold"), fg=WHITE, bg=BG).pack(side="left")
        tk.Label(top, text="用双拳击中随机出现的地鼠", font=("Microsoft YaHei UI", 11), fg=MUTED, bg=BG).pack(side="left", padx=18, pady=8)

        body = tk.Frame(self.root, bg=BG, padx=20)
        body.pack()
        self.canvas = tk.Canvas(body, width=WIDTH, height=HEIGHT, bg="#18263b", highlightthickness=0)
        self.canvas.pack(side="left")
        self._draw_waiting("点击「开始游戏」启用摄像头")

        side = tk.Frame(body, width=275, height=HEIGHT, bg=PANEL, padx=18, pady=17)
        side.pack(side="left", fill="y", padx=(12, 0))
        side.pack_propagate(False)
        self._heading(side, "游戏")
        self.game_box = ttk.Combobox(side, textvariable=self.game_var, values=list(GAMES), state="readonly", style="Dark.TCombobox")
        self.game_box.pack(fill="x", pady=(6, 18))

        self._heading(side, "摄像头")
        row = tk.Frame(side, bg=PANEL)
        row.pack(fill="x", pady=(6, 18))
        self.camera_box = ttk.Combobox(row, textvariable=self.camera_var, values=[f"摄像头 {i}" for i in range(6)], state="readonly", width=15, style="Dark.TCombobox")
        self.camera_box.pack(side="left", fill="x", expand=True)
        self.scan_button = self._button(row, "检测", self.scan_cameras, secondary=True)
        self.scan_button.pack(side="left", padx=(7, 0))

        self._heading(side, "目标帧率")
        self.fps_box = tk.Spinbox(side, from_=5, to=30, increment=5, textvariable=self.fps_var, font=("Microsoft YaHei UI", 11), bg="#243650", fg=WHITE, buttonbackground="#344763", relief="flat", width=6)
        self.fps_box.pack(anchor="w", pady=(6, 18))

        self._heading(side, "地鼠停留时间")
        self.level_box = ttk.Combobox(side, textvariable=self.level_var, values=["轻松（1.8 秒）", "标准（1.4 秒）", "挑战（1.0 秒）"], state="readonly", style="Dark.TCombobox")
        self.level_box.pack(fill="x", pady=(6, 18))

        self._heading(side, "出拳灵敏度")
        tk.Scale(side, from_=1.3, to=.35, resolution=.05, orient="horizontal", variable=self.speed_var,
                 bg=PANEL, fg=WHITE, troughcolor="#344763", activebackground=ACCENT,
                 highlightthickness=0, showvalue=False).pack(fill="x", pady=(3, 0))
        tk.Label(side, text="向左更稳 · 向右更灵敏", bg=PANEL, fg=MUTED, font=("Microsoft YaHei UI", 9)).pack(anchor="w", pady=(0, 18))

        self.start_button = self._button(side, "开始游戏", self.start)
        self.start_button.pack(fill="x", pady=(0, 8))
        self.pause_button = self._button(side, "暂停", self.pause, secondary=True)
        self.pause_button.pack(fill="x", pady=(0, 8))
        self.pause_button.configure(state="disabled")
        self.stop_button = self._button(side, "结束", self.stop, secondary=True)
        self.stop_button.pack(fill="x")
        self.stop_button.configure(state="disabled")

        stats = tk.Frame(self.root, bg=BG, padx=22, pady=12)
        stats.pack(fill="x")
        for label, variable in (("得分", self.score_var), ("漏掉", self.miss_var), ("剩余", self.time_var)):
            tk.Label(stats, text=label, font=("Microsoft YaHei UI", 10), fg=MUTED, bg=BG).pack(side="left", padx=(0, 6))
            tk.Label(stats, textvariable=variable, font=("Microsoft YaHei UI", 15, "bold"), fg=ACCENT, bg=BG).pack(side="left", padx=(0, 28))
        tk.Label(stats, textvariable=self.status_var, font=("Microsoft YaHei UI", 10), fg=MUTED, bg=BG).pack(side="right")

    def _heading(self, parent, text):
        tk.Label(parent, text=text, font=("Microsoft YaHei UI", 11, "bold"), fg=WHITE, bg=PANEL).pack(anchor="w")

    def _button(self, parent, text, command, secondary=False):
        return tk.Button(parent, text=text, command=command, font=("Microsoft YaHei UI", 10, "bold"),
                         bg="#344763" if secondary else ACCENT, fg=WHITE if secondary else "#18263b",
                         activebackground="#506988" if secondary else "#ffd076", relief="flat", cursor="hand2", pady=8)

    def _draw_waiting(self, text):
        self.canvas.delete("all")
        self.canvas.create_oval(332, 188, 468, 324, fill="#273b56", outline=ACCENT, width=3)
        self.canvas.create_text(400, 255, text="拳", fill=ACCENT, font=("Microsoft YaHei UI", 50, "bold"))
        self.canvas.create_text(400, 365, text=text, fill=WHITE, font=("Microsoft YaHei UI", 17))
        self.canvas.create_text(400, 400, text="面对镜头挥拳，命中画面中的地鼠", fill=MUTED, font=("Microsoft YaHei UI", 11))

    def scan_cameras(self):
        self.scan_button.configure(state="disabled")
        self.start_button.configure(state="disabled")
        self.status_var.set("正在检测摄像头…")

        def scan():
            found = []
            for i in range(6):
                cap = self._open_camera(i)
                if cap.isOpened():
                    found.append(f"摄像头 {i}")
                cap.release()
            self._post(("cameras", found))

        threading.Thread(target=scan, daemon=True).start()

    @staticmethod
    def _open_camera(index):
        if sys.platform == "win32":
            cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
            if cap.isOpened():
                return cap
            cap.release()
        return cv2.VideoCapture(index)

    def start(self):
        try:
            fps = int(self.fps_var.get())
            if not 5 <= fps <= 30:
                raise ValueError
            index = int(self.camera_var.get().split()[-1])
        except (ValueError, tk.TclError):
            messagebox.showerror("参数错误", "请选择摄像头，帧率请输入 5 到 30。")
            return
        if self.worker and self.worker.is_alive():
            return
        while not self.events.empty():
            try:
                self.events.get_nowait()
            except queue.Empty:
                break
        seconds = {"轻松（1.8 秒）": 1.8, "标准（1.4 秒）": 1.4, "挑战（1.0 秒）": 1.0}[self.level_var.get()]
        self.game = GAMES[self.game_var.get()](mole_seconds=seconds, punch_speed=self.speed_var.get())
        self.score_var.set("0")
        self.miss_var.set("0")
        self.time_var.set("60 秒")
        self.stop_event = threading.Event()
        self.last_frame_at = None
        self.status_var.set("正在打开摄像头并加载姿态模型（首次运行会下载模型）…")
        self.start_button.configure(state="disabled")
        self.scan_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        for widget in (self.game_box, self.camera_box, self.fps_box, self.level_box):
            widget.configure(state="disabled")
        self.worker = threading.Thread(target=self._camera_loop, args=(index, fps, self.stop_event), daemon=True)
        self.worker.start()

    def _post(self, item):
        try:
            self.events.put_nowait(item)
        except queue.Full:
            try:
                self.events.get_nowait()
            except queue.Empty:
                pass
            self.events.put_nowait(item)

    def _camera_loop(self, index, fps, stop_event):
        cap = None
        tracker = None
        try:
            cap = self._open_camera(index)
            if not cap.isOpened():
                raise RuntimeError(f"无法打开摄像头 {index}。请检查摄像头权限或尝试其他编号。")
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 800)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 600)
            cap.set(cv2.CAP_PROP_FPS, fps)
            tracker = PoseTracker()
            failures = 0
            while not stop_event.is_set():
                begun = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    failures += 1
                    if failures >= 10:
                        raise RuntimeError("摄像头连续读取失败。请关闭占用摄像头的程序后重试。")
                    stop_event.wait(.05)
                    continue
                failures = 0
                rgb, wrists, skeleton = tracker.process(frame)
                self._post(("frame", rgb, wrists, skeleton, time.monotonic()))
                stop_event.wait(max(0, 1 / fps - (time.monotonic() - begun)))
        except Exception as error:
            if not stop_event.is_set():
                self._post(("error", str(error)))
        finally:
            if tracker:
                tracker.close()
            if cap:
                cap.release()

    def _poll(self):
        try:
            while True:
                item = self.events.get_nowait()
                kind = item[0]
                if kind == "frame" and self.game:
                    self._show_frame(*item[1:])
                elif kind == "error":
                    self.stop()
                    messagebox.showerror("运行失败", item[1])
                elif kind == "cameras":
                    self.scan_button.configure(state="normal")
                    self.start_button.configure(state="normal")
                    if item[1]:
                        self.camera_box.configure(values=item[1])
                        self.camera_var.set(item[1][0])
                        self.status_var.set(f"找到 {len(item[1])} 个摄像头")
                    else:
                        self.status_var.set("没有找到摄像头，请检查系统权限")
        except queue.Empty:
            pass
        if self.game and self.game.started is not None and not self.game.finished:
            now = time.monotonic()
            if self.game.paused_at is None and self.last_frame_at and now - self.last_frame_at > .5:
                self.game.update({}, now)
            self._update_stats(now)
        if self.game is None and self.worker and not self.worker.is_alive():
            self.start_button.configure(state="normal")
        self.root.after(30, self._poll)

    def _show_frame(self, rgb, wrists, skeleton, now):
        if self.game.started is None:
            self.game.start(now)
            self.pause_button.configure(state="normal")
        if self.last_frame_at:
            fps = 1 / max(.001, now - self.last_frame_at)
            self.actual_fps = fps if self.actual_fps == 0 else self.actual_fps * .8 + fps * .2
        self.last_frame_at = now
        hit = self.game.update(wrists, now)
        if hit:
            self.flash_until = now + .25
        self.photo = ImageTk.PhotoImage(Image.fromarray(rgb).resize((WIDTH, HEIGHT)))
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, image=self.photo, anchor="nw")
        self.canvas.create_rectangle(0, 0, WIDTH, 52, fill="#101827", outline="")
        self.canvas.create_text(18, 25, anchor="w", text=f"{self.game.title}   ·   {self.actual_fps:.0f} FPS", fill=WHITE, font=("Microsoft YaHei UI", 12, "bold"))
        self.game.draw(self.canvas, WIDTH, HEIGHT)
        for x1, y1, x2, y2 in skeleton:
            self.canvas.create_line(x1*WIDTH, y1*HEIGHT, x2*WIDTH, y2*HEIGHT, fill="#65e5c1", width=4)
        for name, point in wrists.items():
            x, y = point.x*WIDTH, point.y*HEIGHT
            self.canvas.create_oval(x-17, y-17, x+17, y+17, fill="#f45266", outline=WHITE, width=3)
            self.canvas.create_text(x, y-28, text=name, fill=WHITE, font=("Microsoft YaHei UI", 10, "bold"))
        if now < self.flash_until:
            self.canvas.create_text(WIDTH/2, 110, text="命中！ +1", fill="#ffe18a", font=("Microsoft YaHei UI", 26, "bold"))
        if self.game.paused_at is not None:
            self.canvas.create_rectangle(0, 0, WIDTH, HEIGHT, fill="#101827", stipple="gray50", outline="")
            self.canvas.create_text(WIDTH/2, HEIGHT/2, text="已暂停", fill=WHITE, font=("Microsoft YaHei UI", 30, "bold"))
        if self.game.finished:
            self.canvas.create_rectangle(0, 0, WIDTH, HEIGHT, fill="#101827", stipple="gray50", outline="")
            self.canvas.create_text(WIDTH/2, HEIGHT/2-30, text="时间到！", fill=WHITE, font=("Microsoft YaHei UI", 30, "bold"))
            self.canvas.create_text(WIDTH/2, HEIGHT/2+20, text=f"最终得分 {self.game.score}", fill=ACCENT, font=("Microsoft YaHei UI", 20, "bold"))
            self.pause_button.configure(state="disabled")
        self._update_stats(now)

    def _update_stats(self, now):
        self.score_var.set(str(self.game.score))
        self.miss_var.set(str(self.game.misses))
        self.time_var.set(f"{self.game.remaining(now):.0f} 秒")
        if self.game.finished:
            self.status_var.set("本局结束 · 点击「结束」后可重新开始")
        elif self.game.paused_at is not None:
            self.status_var.set("游戏已暂停")
        else:
            self.status_var.set("识别到双手" if len(self.game.previous) == 2 else "请让上半身和双手进入画面")

    def pause(self):
        if not self.game or self.game.finished:
            return
        now = time.monotonic()
        if self.game.paused_at is None:
            self.game.pause(now)
            self.pause_button.configure(text="继续")
        else:
            self.game.resume(now)
            self.pause_button.configure(text="暂停")

    def stop(self):
        self.stop_event.set()
        self.game = None
        self.start_button.configure(state="disabled" if self.worker and self.worker.is_alive() else "normal")
        self.scan_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.pause_button.configure(state="disabled", text="暂停")
        for widget in (self.game_box, self.camera_box, self.level_box):
            widget.configure(state="readonly")
        self.fps_box.configure(state="normal")
        self.status_var.set("已结束 · 可以调整参数重新开始")
        self._draw_waiting("点击「开始游戏」再玩一局")

    def close(self):
        self.stop_event.set()
        self.root.destroy()


if __name__ == "__main__":
    GameApp(tk.Tk()).root.mainloop()
