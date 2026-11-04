"""Camera and pose estimation. All methods are called from the camera thread."""

from pathlib import Path
import time
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np

from game import Wrist


MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
MODEL_PATH = Path(__file__).parent / "models" / "pose_landmarker_lite.task"
SKELETON = ((11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24))


def ensure_model():
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size > 1_000_000:
        return
    MODEL_PATH.parent.mkdir(exist_ok=True)
    temporary = MODEL_PATH.with_suffix(".download")
    try:
        urlretrieve(MODEL_URL, temporary)
        if temporary.stat().st_size < 1_000_000:
            raise RuntimeError("姿态模型下载不完整")
        temporary.replace(MODEL_PATH)
    finally:
        temporary.unlink(missing_ok=True)


class PoseTracker:
    def __init__(self):
        ensure_model()
        options = mp.tasks.vision.PoseLandmarkerOptions(
            # The native MediaPipe loader cannot open non-ASCII Windows paths.
            base_options=mp.tasks.BaseOptions(model_asset_buffer=MODEL_PATH.read_bytes()),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self.detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.last_timestamp = 0
        self.epoch = time.monotonic()

    def close(self):
        self.detector.close()

    def process(self, bgr):
        bgr = cv2.flip(bgr, 1)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        timestamp = max(self.last_timestamp + 1, int((time.monotonic() - self.epoch) * 1000))
        self.last_timestamp = timestamp
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self.detector.detect_for_video(image, timestamp)
        wrists, skeleton = {}, []
        if result.pose_landmarks:
            marks = result.pose_landmarks[0]
            for name, index in (("左手", 15), ("右手", 16)):
                p = marks[index]
                if p.visibility >= .55 and 0 <= p.x <= 1 and 0 <= p.y <= 1:
                    wrists[name] = Wrist(p.x, p.y, p.z)
            for a, b in SKELETON:
                if marks[a].visibility >= .5 and marks[b].visibility >= .5:
                    skeleton.append((marks[a].x, marks[a].y, marks[b].x, marks[b].y))
        return rgb, wrists, skeleton
