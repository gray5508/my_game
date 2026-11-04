/* MediaPipe's WASM loader uses importScripts, so this must be a classic Worker. */
importScripts("/wasm/vision_bundle.js");

let detector = null;

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const wasm = await Vision.FilesetResolver.forVisionTasks(
        `${self.location.origin}/wasm`,
      );
      detector = await Vision.PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: `${self.location.origin}/models/pose_landmarker_lite.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      const probeCanvas = new OffscreenCanvas(64, 64);
      probeCanvas.getContext("2d").fillRect(0, 0, 64, 64);
      const probe = probeCanvas.transferToImageBitmap();
      detector.detectForVideo(probe, 0);
      probe.close();
      self.postMessage({ type: "ready" });
    } else if (message.type === "frame" && detector) {
      const bitmap = message.bitmap;
      const result = detector.detectForVideo(bitmap, message.timestamp);
      bitmap.close();
      self.postMessage({
        type: "pose",
        points: result.landmarks[0] ?? null,
        at: message.timestamp / 1000,
      });
    }
  } catch (error) {
    if (message.bitmap) message.bitmap.close();
    self.postMessage({
      type: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
