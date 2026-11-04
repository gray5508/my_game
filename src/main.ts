import "./style.css";
import {
  BEAT,
  PunchDetector,
  PoseSmoother,
  RhythmSession,
  mapPoseToWorld,
} from "./logic.js";
import { SongAudio } from "./audio";
import { Stage } from "./stage";

type Landmark = { x: number; y: number; z: number; visibility?: number };
type Side = "L" | "R";
const SKELETON = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const arena = get<HTMLDivElement>("arena");
const stage = new Stage(arena);
const audio = new SongAudio();
const smoother = new PoseSmoother(0.11);
const punches = new PunchDetector(0.45);
const video = get<HTMLVideoElement>("cameraVideo");
const camCanvas = get<HTMLCanvasElement>("cameraCanvas");
const camContext = camCanvas.getContext("2d")!;
const cameraButton = get<HTMLButtonElement>("cameraButton");
const cameraSelect = get<HTMLSelectElement>("cameraSelect");
const fpsSelect = get<HTMLSelectElement>("fpsSelect");
const startButton = get<HTMLButtonElement>("startButton");
const overlayStart = get<HTMLButtonElement>("overlayStart");
const overlay = get<HTMLDivElement>("startOverlay");
const statusText = get<HTMLParagraphElement>("statusText");
const trackingState = get<HTMLSpanElement>("trackingState");
const scorePop = get<HTMLDivElement>("scorePop");
const countdown = get<HTMLDivElement>("countdown");
let stream: MediaStream | null = null;
let session: RhythmSession | null = null;
let workerReady = false;
let busy = false;
let lastCapture = 0;
let modelFailed = false;
let lastCount = "";
let resultShown = false;

function status(message: string) {
  statusText.textContent = message;
}

const worker = new Worker("/pose-worker.js");
worker.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "ready") {
    workerReady = true;
    modelFailed = false;
    trackingState.textContent = stream ? "骨架追踪就绪" : "姿态模型就绪";
    status(
      stream
        ? "请站到镜头前，让肩膀和双手进入画面。"
        : "姿态模型已加载。开启摄像头即可驱动小人。",
    );
  } else if (message.type === "pose") {
    busy = false;
    const raw = message.points as Landmark[] | null;
    const at = message.at as number;
    const smooth = smoother.update(raw, at);
    const worldPose = mapPoseToWorld(smooth);
    stage.setPose(worldPose, at);
    drawSkeleton(raw);
    const visible =
      !!raw?.[11] &&
      !!raw?.[12] &&
      (raw[11].visibility ?? 0) > 0.5 &&
      (raw[12].visibility ?? 0) > 0.5;
    trackingState.textContent = visible
      ? "骨架已锁定 · 跟着节拍挥拳"
      : "请让上半身进入画面";
    if (visible) {
      const wrists: Record<
        string,
        Landmark & {
          reach: number;
          visual: { x: number; y: number; z: number };
        }
      > = {};
      const shoulderX = (raw![11].x + raw![12].x) / 2;
      const shoulderZ = (raw![11].z + raw![12].z) / 2;
      for (const index of [15, 16]) {
        const p = raw![index];
        const elbow = raw![index === 15 ? 13 : 14];
        const shoulder = raw![index === 15 ? 11 : 12];
        const visual = worldPose[index];
        if (p && elbow && shoulder && visual && (p.visibility ?? 0) > 0.55) {
          const a = [shoulder.x - elbow.x, shoulder.y - elbow.y];
          const b = [p.x - elbow.x, p.y - elbow.y];
          const dot = a[0] * b[0] + a[1] * b[1];
          const length = Math.hypot(...a) * Math.hypot(...b);
          const reach =
            length > 0.0001
              ? Math.acos(Math.max(-1, Math.min(1, dot / length))) / Math.PI
              : 0;
          wrists[String(index)] = {
            ...p,
            x: shoulderX - p.x,
            z: p.z - shoulderZ,
            reach,
            visual,
          };
        }
      }
      for (const hit of punches.update(wrists, at))
        if (!attempt(hit.side as Side, hit, at)) {
          stage.hit(hit.side as Side, hit, false);
          if (session && !session.finished)
            showFeedback("挥拳已识别 · 等待节拍", "soft");
        }
    } else punches.update({}, at);
  } else if (message.type === "error") {
    busy = false;
    modelFailed = true;
    workerReady = false;
    trackingState.textContent = "姿态模型加载失败";
    status(`姿态模型错误：${message.detail}。仍可使用 A / L 键试玩。`);
  }
};
worker.onerror = () => {
  busy = false;
  modelFailed = true;
  workerReady = false;
  trackingState.textContent = "追踪线程失败";
  status("骨架追踪线程无法启动，仍可使用 A / L 键试玩。");
};
worker.postMessage({ type: "init" });

async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput",
  );
  const old = cameraSelect.value;
  cameraSelect.innerHTML = '<option value="">默认摄像头</option>';
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `摄像头 ${index + 1}`;
    cameraSelect.append(option);
  });
  cameraSelect.value = devices.some((d) => d.deviceId === old) ? old : "";
}

async function connectCamera() {
  if (stream) {
    disconnectCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    status("当前浏览器不支持摄像头，请使用 localhost 或 HTTPS 打开。");
    return;
  }
  cameraButton.disabled = true;
  trackingState.textContent = "正在请求摄像头…";
  try {
    const deviceId = cameraSelect.value;
    let expired = false;
    let timeoutId: number | undefined;
    const request = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 960 },
          height: { ideal: 720 },
          frameRate: { ideal: Number(fpsSelect.value) },
        },
      })
      .then((candidate) => {
        if (expired) {
          candidate.getTracks().forEach((track) => track.stop());
          throw new Error("摄像头权限请求已超时");
        }
        return candidate;
      });
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        expired = true;
        reject(new Error("摄像头权限未响应，请检查浏览器地址栏的权限提示"));
      }, 12000);
    });
    try {
      stream = await Promise.race([request, timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
    video.srcObject = stream;
    await video.play();
    get<HTMLDivElement>("cameraPreview").classList.add("visible");
    cameraButton.querySelector("span:nth-child(2)")!.innerHTML =
      "关闭摄像头<small>停止骨架追踪</small>";
    trackingState.textContent = workerReady
      ? "正在寻找人体骨架"
      : "摄像头已连接 · 模型加载中";
    status(
      modelFailed
        ? "摄像头已连接，但姿态模型不可用。请刷新重试。"
        : "摄像头已连接，请让上半身进入画面。",
    );
    await listCameras();
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const reason = error instanceof Error ? error.message : String(error);
    trackingState.textContent = "摄像头不可用";
    status(`无法打开摄像头：${reason}。可先用 A / L 键练习。`);
  } finally {
    cameraButton.disabled = false;
  }
}

function disconnectCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  get<HTMLDivElement>("cameraPreview").classList.remove("visible");
  cameraButton.querySelector("span:nth-child(2)")!.innerHTML =
    "开启摄像头<small>接入骨架追踪</small>";
  trackingState.textContent = "摄像头已关闭";
  stage.setPose([], 0);
  smoother.update(null, performance.now() / 1000);
  punches.update({}, performance.now() / 1000);
  status("摄像头已关闭，仍可使用 A / L 键练习。");
}

function drawSkeleton(points: Landmark[] | null) {
  if (!video.videoWidth || !video.videoHeight) return;
  if (
    camCanvas.width !== video.videoWidth ||
    camCanvas.height !== video.videoHeight
  ) {
    camCanvas.width = video.videoWidth;
    camCanvas.height = video.videoHeight;
  }
  camContext.clearRect(0, 0, camCanvas.width, camCanvas.height);
  if (!points) return;
  camContext.strokeStyle = "#65f5e7";
  camContext.lineWidth = 5;
  camContext.shadowBlur = 10;
  camContext.shadowColor = "#30f2dd";
  for (const [a, b] of SKELETON) {
    const p = points[a],
      q = points[b];
    if (!p || !q || (p.visibility ?? 0) < 0.5 || (q.visibility ?? 0) < 0.5)
      continue;
    camContext.beginPath();
    camContext.moveTo(p.x * camCanvas.width, p.y * camCanvas.height);
    camContext.lineTo(q.x * camCanvas.width, q.y * camCanvas.height);
    camContext.stroke();
  }
  camContext.shadowBlur = 0;
  for (const i of [15, 16]) {
    const p = points[i];
    if (!p || (p.visibility ?? 0) < 0.55) continue;
    camContext.fillStyle = "#ff628f";
    camContext.beginPath();
    camContext.arc(
      p.x * camCanvas.width,
      p.y * camCanvas.height,
      13,
      0,
      Math.PI * 2,
    );
    camContext.fill();
  }
}

function showFeedback(message: string, tone = "") {
  scorePop.textContent = message;
  scorePop.className = `score-pop ${tone}`;
  void scorePop.offsetWidth;
  scorePop.classList.add("show");
}

function attempt(
  side: Side,
  impact?: { x: number; y: number },
  at = performance.now() / 1000,
) {
  if (!session || session.finished) return false;
  const result = session.attempt(side, at);
  if (!result) return false;
  stage.hit(side, impact);
  audio.hit(result.grade);
  showFeedback(
    `${result.grade}  +${result.points}`,
    result.grade === "GOOD" ? "good" : "",
  );
  get<HTMLElement>("score").textContent = String(session.score).padStart(
    5,
    "0",
  );
  get<HTMLElement>("combo").innerHTML = `${session.combo}<span>×</span>`;
  get<HTMLElement>("accuracy").innerHTML = `${session.accuracy}<span>%</span>`;
  return true;
}

async function startGame() {
  if (session && !session.finished) return;
  try {
    await audio.ready();
  } catch {
    status("音频不可用；画面与键盘操作仍可继续。");
  }
  const startAt = performance.now() / 1000 + 3 * BEAT;
  stage.playing = true;
  session = new RhythmSession(startAt);
  resultShown = false;
  lastCount = "";
  if (audio.context) audio.schedule(audio.now() + 3 * BEAT);
  overlay.classList.add("hidden");
  startButton.disabled = true;
  startButton.style.opacity = ".55";
  get<HTMLElement>("score").textContent = "00000";
  get<HTMLElement>("combo").innerHTML = "0<span>×</span>";
  get<HTMLElement>("accuracy").innerHTML = "100<span>%</span>";
  status(
    stream
      ? "跟着音符挥拳！左右击打圈亮起时出手。"
      : "键盘练习中：按 A 打左侧，按 L 打右侧。",
  );
}

function finishGame() {
  if (!session || resultShown) return;
  resultShown = true;
  stage.playing = false;
  startButton.disabled = false;
  startButton.style.opacity = "1";
  get<HTMLElement>("overlayTitle").textContent = session.hits
    ? "这一曲，打得漂亮。"
    : "再试一次，找到节拍。";
  get<HTMLElement>("overlayText").textContent =
    `得分 ${session.score} · 命中 ${session.hits}/${session.notes.length} · 最佳连击 ${session.bestCombo}。再来一次，刷新你的记录。`;
  overlay.querySelector(".eyebrow")!.textContent = "TRACK COMPLETE";
  overlay.querySelector("small")!.textContent =
    "提示：没有摄像头也能用 A / L 键击打音符";
  overlayStart.innerHTML = "再来一局 <span>↗</span>";
  overlay.classList.remove("hidden");
  status("演奏结束。可以继续挑战，或调整灵敏度后再试。");
}

function loop() {
  const now = performance.now() / 1000;
  if (
    stream &&
    workerReady &&
    !busy &&
    video.readyState >= 2 &&
    performance.now() - lastCapture > 1000 / Number(fpsSelect.value)
  ) {
    busy = true;
    lastCapture = performance.now();
    createImageBitmap(video)
      .then((bitmap) =>
        worker.postMessage(
          { type: "frame", bitmap, timestamp: performance.now() },
          [bitmap],
        ),
      )
      .catch(() => {
        busy = false;
      });
  }
  if (session) {
    session.tick(now, stream && workerReady ? 0.18 : 0);
    const remaining = session.startAt - now;
    const count =
      remaining > 0
        ? String(Math.ceil(remaining / BEAT))
        : remaining > -BEAT * 0.5
          ? "GO!"
          : "";
    if (count !== lastCount) {
      lastCount = count;
      countdown.textContent = count;
      countdown.classList.toggle("active", !!count);
    }
    const progress = Math.max(
      0,
      Math.min(1, (now - session.startAt) / session.duration),
    );
    get<HTMLElement>("progressFill").style.width = `${progress * 100}%`;
    get<HTMLElement>("accuracy").innerHTML =
      `${session.accuracy}<span>%</span>`;
    if (session.finished) finishGame();
  }
  stage.render(now, session);
}
stage.renderer.setAnimationLoop(loop);

cameraButton.addEventListener("click", connectCamera);
cameraSelect.addEventListener("change", () => {
  if (stream) {
    disconnectCamera();
    connectCamera();
  }
});
startButton.addEventListener("click", startGame);
overlayStart.addEventListener("click", startGame);
get<HTMLInputElement>("smoothRange").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  smoother.tau = value / 1000;
  get<HTMLElement>("smoothValue").textContent = `${value} ms`;
});
get<HTMLInputElement>("speedRange").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  punches.speed = value / 100;
  get<HTMLElement>("speedValue").textContent =
    value < 40 ? "灵敏" : value > 65 ? "稳健" : "标准";
});
get<HTMLButtonElement>("muteButton").addEventListener("click", (event) => {
  audio.setMuted(!audio.muted);
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = audio.muted ? "♪   音乐已静音" : "♫   音乐开启";
  button.setAttribute("aria-pressed", String(audio.muted));
});
document.addEventListener("keydown", (event) => {
  if (
    event.repeat ||
    ["INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)
  )
    return;
  const side =
    event.key.toLowerCase() === "a"
      ? "L"
      : event.key.toLowerCase() === "l"
        ? "R"
        : null;
  if (side) {
    event.preventDefault();
    attempt(side);
  }
});
window.addEventListener("beforeunload", () => {
  stream?.getTracks().forEach((track) => track.stop());
  worker.terminate();
});
listCameras().catch(() => {});
