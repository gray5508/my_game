export const BPM = 108;
export const BEAT = 60 / BPM;
export const TRAVEL = 1.25;
export const WINDOW = 0.27;
export const HIT_Y = -0.05;

const bars = [
  "L...L...",
  "R...R...",
  "L...L...",
  "R...R...",
  "L...L...",
  "R...R...",
  "L...L...",
  "R...R...",
];

export function makeChart() {
  return bars.flatMap((bar, barIndex) =>
    [...bar].flatMap((side, slot) =>
      side === "."
        ? []
        : [
            {
              id: `${barIndex}-${slot}`,
              side,
              at: (barIndex * 4 + slot / 2) * BEAT,
              state: "pending",
            },
          ],
    ),
  );
}

export class RhythmSession {
  constructor(startAt = 0) {
    this.startAt = startAt;
    this.notes = makeChart();
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.finished = false;
  }

  get duration() {
    return 32 * BEAT;
  }
  get accuracy() {
    return this.hits + this.misses
      ? Math.round((this.hits / (this.hits + this.misses)) * 100)
      : 100;
  }

  attempt(side, now) {
    const elapsed = now - this.startAt;
    let closest = null;
    for (const note of this.notes) {
      if (note.state !== "pending" || note.side !== side) continue;
      const error = Math.abs(note.at - elapsed);
      if (error <= WINDOW && (!closest || error < closest.error))
        closest = { note, error };
    }
    if (!closest) return null;
    const { note, error } = closest;
    note.state = "hit";
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const grade = error <= 0.085 ? "PERFECT" : "GOOD";
    const points = Math.round(
      (grade === "PERFECT" ? 120 : 80) * (1 + Math.floor(this.combo / 5) * 0.2),
    );
    this.score += points;
    return { note, grade, points };
  }

  tick(now, grace = 0) {
    const elapsed = now - this.startAt;
    for (const note of this.notes) {
      if (note.state === "pending" && elapsed > note.at + WINDOW + grace) {
        note.state = "miss";
        this.misses++;
        this.combo = 0;
      }
    }
    this.finished = elapsed > this.duration + 0.8;
  }
}

export class PoseSmoother {
  constructor(tau = 0.11) {
    this.tau = tau;
    this.lastTime = null;
    this.points = [];
  }

  update(landmarks, now) {
    if (!landmarks) {
      this.points = [];
      this.lastTime = null;
      return [];
    }
    const dt =
      this.lastTime === null ? 1 : Math.max(0.001, now - this.lastTime);
    const alpha = 1 - Math.exp(-dt / this.tau);
    this.lastTime = now;
    this.points = landmarks.map((p, i) => {
      if ((p.visibility ?? 1) < 0.45) return null;
      const old = this.points[i];
      if (!old) return { ...p };
      return {
        ...p,
        x: old.x + (p.x - old.x) * alpha,
        y: old.y + (p.y - old.y) * alpha,
        z: old.z + (p.z - old.z) * alpha,
      };
    });
    return this.points;
  }
}

// A front-facing webcam is mirrored into a rear-view avatar in world space.
// Negative z points away from the virtual camera and toward the note lanes.
export function mapPoseToWorld(points) {
  const left = points?.[11];
  const right = points?.[12];
  if (!left || !right) return [];
  const centerX = (left.x + right.x) / 2;
  const centerY = (left.y + right.y) / 2;
  const shoulderZ = (left.z + right.z) / 2;
  const scale = Math.max(
    3.5,
    Math.min(9, 1.7 / Math.max(0.01, Math.abs(left.x - right.x))),
  );
  return points.map((p) =>
    p
      ? {
          x: Math.max(-3, Math.min(3, (centerX - p.x) * scale)),
          y: Math.max(-3.2, Math.min(3.2, (centerY - p.y) * scale + 1.43)),
          z: Math.max(-2.2, Math.min(2.2, (p.z - shoulderZ) * scale * 0.8)),
        }
      : null,
  );
}

export function relativeWrist(wrist, leftShoulder, rightShoulder) {
  const width = Math.max(0.06, Math.abs(leftShoulder.x - rightShoulder.x));
  return {
    x: ((leftShoulder.x + rightShoulder.x) / 2 - wrist.x) / width,
    z: (wrist.z - (leftShoulder.z + rightShoulder.z) / 2) / width,
  };
}

export class PunchDetector {
  constructor(speed = 0.45) {
    this.speed = speed;
    this.history = new Map();
    this.arm = new Map();
    this.lastPunch = { L: -100, R: -100 };
  }

  update(wrists, now) {
    const fired = [];
    for (const [name, p] of Object.entries(wrists)) {
      const side = name === "15" ? "L" : "R";
      const history = this.history.get(name) ?? [];
      history.push({ x: p.x, z: p.z, reach: p.reach, at: now });
      while (history.length && now - history[0].at > 0.24) history.shift();
      this.history.set(name, history);
      const arm = this.arm.get(name) ?? { armed: true };
      this.arm.set(name, arm);
      if (!arm.armed) {
        const inward = side === "L" ? p.x - arm.x : arm.x - p.x;
        const backward = p.z - arm.z;
        const flex = (arm.reach ?? 0) - (p.reach ?? 0);
        if (
          now - arm.at > 0.24 &&
          (inward > 0.12 ||
            backward > 0.15 ||
            flex > 0.08 ||
            now - arm.at > 0.75)
        )
          arm.armed = true;
        else continue;
      }
      const old = history[0];
      const dt = now - old.at;
      if (dt < 0.08 || now - this.lastPunch[side] < 0.3) continue;
      const outward = Math.max(0, side === "L" ? old.x - p.x : p.x - old.x);
      const forward = Math.max(0, old.z - p.z);
      const extension = Math.max(0, (p.reach ?? 0) - (old.reach ?? 0));
      const strength = outward / 0.35 + forward / 0.275 + extension / 0.11;
      const punchShape =
        forward >= 0.15 ||
        extension >= 0.04 ||
        (outward >= 0.25 && (p.reach ?? 0) > 0.7);
      if (punchShape && strength >= 1.25 * (this.speed / 0.45)) {
        this.lastPunch[side] = now;
        Object.assign(arm, {
          armed: false,
          x: p.x,
          z: p.z,
          reach: p.reach,
          at: now,
        });
        fired.push({ side, x: p.visual?.x ?? 0, y: p.visual?.y ?? HIT_Y });
      }
    }
    for (const key of this.history.keys())
      if (!(key in wrists)) {
        this.history.delete(key);
        this.arm.delete(key);
      }
    return fired;
  }
}
