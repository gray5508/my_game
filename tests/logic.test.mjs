import test from "node:test";
import assert from "node:assert/strict";
import {
  CHART_BEATS,
  beatTime,
  makeChart,
  RhythmSession,
  PoseSmoother,
  PunchDetector,
  mapPoseToWorld,
  relativeWrist,
} from "../src/logic.js";

test("chart stays inside the longer song", () => {
  const chart = makeChart();
  assert.equal(CHART_BEATS, 64);
  assert.equal(chart.length, 32);
  assert.ok(
    chart.every((note) => note.at >= 0 && note.at < beatTime(CHART_BEATS)),
  );
  assert.deepEqual(
    chart.slice(0, 4).map((note) => note.side),
    ["L", "L", "R", "R"],
  );
  assert.ok(chart[1].at - chart[0].at > 1);
});

test("later beats and repeat rounds become faster", () => {
  assert.ok(beatTime(48) - beatTime(32) < beatTime(16));
  assert.ok(
    new RhythmSession(0, 1.06).duration < new RhythmSession(0, 1).duration,
  );
  const song = new RhythmSession(5);
  song.tick(5 + song.duration + 0.81);
  assert.equal(song.finished, true);
});

test("punch scores only the matching note once, miss breaks combo", () => {
  const game = new RhythmSession(10);
  const first = game.notes[0];
  assert.equal(
    game.attempt(first.side === "L" ? "R" : "L", 10 + first.at),
    null,
  );
  assert.equal(game.attempt(first.side, 10 + first.at)?.grade, "PERFECT");
  assert.equal(game.attempt(first.side, 10 + first.at), null);
  game.tick(10 + game.notes[1].at + 0.3);
  assert.equal(game.combo, 0);
  assert.ok(game.misses > 0);
});

test("camera inference delay does not erase a punch captured on beat", () => {
  const game = new RhythmSession(10);
  game.tick(10.3, 0.18);
  assert.equal(game.attempt("L", 10.1)?.grade, "GOOD");
});

test("pose smoothing attenuates a jump", () => {
  const smoother = new PoseSmoother(0.1);
  smoother.update([{ x: 0, y: 0, z: 0, visibility: 1 }], 0);
  const next = smoother.update([{ x: 1, y: 0, z: 0, visibility: 1 }], 0.05);
  assert.ok(next[0].x > 0 && next[0].x < 1);
});

test("front-facing camera maps left fist to avatar left and forward into the scene", () => {
  const pose = (wristX, wristZ = -0.1) => {
    const points = Array.from({ length: 33 }, () => null);
    points[11] = { x: 0.625, y: 0.35, z: 0 };
    points[12] = { x: 0.375, y: 0.35, z: 0 };
    points[15] = { x: wristX, y: 0.45, z: wristZ };
    return points;
  };
  const rest = mapPoseToWorld(pose(0.7))[15];
  const punch = mapPoseToWorld(pose(0.75, -0.25))[15];
  assert.ok(rest.x < 0 && punch.x < rest.x);
  assert.ok(rest.z < 0 && punch.z < rest.z);
});

test("wrist motion is comparable at different camera distances", () => {
  const near = relativeWrist(
    { x: 0.8, z: -0.12 },
    { x: 0.65, z: 0 },
    { x: 0.35, z: 0 },
  );
  const far = relativeWrist(
    { x: 0.6, z: -0.04 },
    { x: 0.55, z: 0 },
    { x: 0.45, z: 0 },
  );
  assert.ok(Math.abs(near.x - far.x) < 1e-9);
  assert.ok(Math.abs(near.z - far.z) < 1e-9);
});

test("directional punch fires without touching a target and respects cooldown", () => {
  const punches = new PunchDetector(0.45);
  assert.deepEqual(
    punches.update(
      { 16: { x: 0.2, z: 0, reach: 0.45, visual: { x: 0, y: 0 } } },
      0,
    ),
    [],
  );
  const hit = punches.update(
    { 16: { x: 0.5, z: 0, reach: 0.52, visual: { x: 0, y: 0 } } },
    0.12,
  );
  assert.equal(hit[0]?.side, "R");
  assert.deepEqual(
    punches.update(
      { 16: { x: 0.6, z: 0, reach: 0.52, visual: { x: 0, y: 0 } } },
      0.2,
    ),
    [],
  );
  assert.deepEqual(
    punches.update({ 16: { x: 0.2, z: 0, reach: 0.4 } }, 0.4),
    [],
  );
  assert.equal(
    punches.update({ 16: { x: 0.5, z: 0, reach: 0.5 } }, 0.55)[0]?.side,
    "R",
  );
  const still = new PunchDetector(0.45);
  still.update({ 15: { x: -0.2, z: 0, reach: 0.5 } }, 0);
  assert.deepEqual(
    still.update({ 15: { x: -0.2, z: 0, reach: 0.5 } }, 0.12),
    [],
  );
  const wave = new PunchDetector(0.45);
  wave.update({ 16: { x: 0.2, z: 0, reach: 0.5 } }, 0);
  assert.deepEqual(wave.update({ 16: { x: 0.7, z: 0, reach: 0.5 } }, 0.12), []);
  const heavy = new PunchDetector(1);
  heavy.update({ 16: { x: 0.2, z: 0, reach: 0.45 } }, 0);
  assert.deepEqual(
    heavy.update({ 16: { x: 0.5, z: 0, reach: 0.52 } }, 0.12),
    [],
  );
});

test("arm extension also detects a forward punch", () => {
  const detector = new PunchDetector(0.45);
  detector.update({ 15: { x: -0.2, z: 0, reach: 0.4 } }, 0);
  assert.equal(
    detector.update({ 15: { x: -0.2, z: 0, reach: 0.55 } }, 0.15)[0]?.side,
    "L",
  );
});

test("a moderate punch registers at standard sensitivity", () => {
  const detector = new PunchDetector(0.45);
  detector.update({ 16: { x: 0.2, z: 0, reach: 0.5 } }, 0);
  assert.equal(
    detector.update({ 16: { x: 0.46, z: 0, reach: 0.54 } }, 0.15)[0]?.side,
    "R",
  );
});
