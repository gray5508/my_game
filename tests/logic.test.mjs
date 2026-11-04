import test from "node:test";
import assert from "node:assert/strict";
import {
  BEAT,
  makeChart,
  RhythmSession,
  PoseSmoother,
  PunchDetector,
} from "../src/logic.js";

test("chart stays inside the 32 beat song", () => {
  const chart = makeChart();
  assert.ok(chart.length > 20);
  assert.ok(chart.every((note) => note.at >= 0 && note.at < 32 * BEAT));
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

test("pose smoothing attenuates a jump and punch requires motion", () => {
  const smoother = new PoseSmoother(0.1);
  smoother.update([{ x: 0, y: 0, z: 0, visibility: 1 }], 0);
  const next = smoother.update([{ x: 1, y: 0, z: 0, visibility: 1 }], 0.05);
  assert.ok(next[0].x > 0 && next[0].x < 1);
  const punches = new PunchDetector(0.75);
  assert.deepEqual(punches.update({ hand: { x: 0.5, y: 0.5, z: 0 } }, 0), []);
  assert.deepEqual(punches.update({ hand: { x: 0.34, y: 0.5, z: 0 } }, 0.1), [
    "L",
  ]);
  assert.deepEqual(
    punches.update({ hand: { x: 0.34, y: 0.5, z: 0 } }, 0.2),
    [],
  );
});
