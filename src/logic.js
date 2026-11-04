export const BPM = 108;
export const BEAT = 60 / BPM;
export const TRAVEL = 1.55;
export const WINDOW = 0.22;

const bars = [
  "L.R.L.R.",
  "L.R.LR..",
  "R.L.R.L.",
  "R.L.RL..",
  "L.R.L.R.",
  "L.RL.R..",
  "R.L.R.L.",
  "L.R.LR..",
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

  tick(now) {
    const elapsed = now - this.startAt;
    for (const note of this.notes) {
      if (note.state === "pending" && elapsed > note.at + WINDOW) {
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

export class PunchDetector {
  constructor(speed = 0.75) {
    this.speed = speed;
    this.previous = new Map();
    this.lastPunch = { L: -100, R: -100 };
  }

  update(wrists, now) {
    const fired = [];
    for (const [name, p] of Object.entries(wrists)) {
      const old = this.previous.get(name);
      this.previous.set(name, { ...p, at: now });
      if (!old) continue;
      const dt = now - old.at;
      if (dt < 0.015 || dt > 0.35 || p.y < 0.1 || p.y > 0.88) continue;
      const side = p.x < 0.39 ? "L" : p.x > 0.61 ? "R" : null;
      if (!side || now - this.lastPunch[side] < 0.28) continue;
      const outward = side === "L" ? old.x - p.x : p.x - old.x;
      const forward = old.z - p.z;
      if (
        (outward >= 0.04 && outward / dt >= this.speed) ||
        (forward >= 0.06 && forward / dt >= this.speed * 1.2)
      ) {
        this.lastPunch[side] = now;
        fired.push(side);
      }
    }
    for (const key of this.previous.keys())
      if (!(key in wrists)) this.previous.delete(key);
    return fired;
  }
}
