"""Pure game rules; another mini-game can implement the same update/draw surface."""

from dataclasses import dataclass
import math
import random
import time


@dataclass(frozen=True)
class Wrist:
    x: float
    y: float
    z: float


@dataclass
class Mole:
    x: float
    y: float
    born: float


class WhackAMole:
    title = "拳击打地鼠"

    def __init__(self, duration=60, mole_seconds=1.4, punch_speed=0.75, rng=None):
        self.duration = duration
        self.mole_seconds = mole_seconds
        self.punch_speed = punch_speed
        self.rng = rng or random.Random()
        self.score = 0
        self.misses = 0
        self.started = None
        self.mole = None
        self.previous = {}
        self.last_hit = {}
        self.finished = False
        self.paused_at = None

    def start(self, now=None):
        now = time.monotonic() if now is None else now
        self.started = now
        self.spawn(now)

    def spawn(self, now):
        old = self.mole
        for _ in range(8):
            x, y = self.rng.uniform(.16, .84), self.rng.uniform(.19, .81)
            if old is None or math.hypot(x - old.x, y - old.y) > .25:
                break
        self.mole = Mole(x, y, now)

    def pause(self, now):
        self.paused_at = now
        self.previous.clear()

    def resume(self, now):
        if self.paused_at is None:
            return
        elapsed = now - self.paused_at
        self.started += elapsed
        if self.mole:
            self.mole.born += elapsed
        self.paused_at = None

    def remaining(self, now):
        if self.started is None:
            return self.duration
        return max(0, self.duration - ((self.paused_at or now) - self.started))

    def update(self, wrists, now):
        """Return the name of a scoring hand, or None."""
        if self.finished or self.started is None or self.paused_at is not None:
            return None
        if self.remaining(now) <= 0:
            self.finished = True
            self.mole = None
            return None
        if self.mole and now - self.mole.born >= self.mole_seconds:
            self.misses += 1
            self.spawn(now)
        hit = None
        for hand, point in wrists.items():
            previous = self.previous.get(hand)
            self.previous[hand] = (point, now)
            if previous is None or self.mole is None:
                continue
            old, old_time = previous
            dt = now - old_time
            if not .015 <= dt <= .35 or now - self.last_hit.get(hand, -100) < .35:
                continue
            planar_speed = math.hypot(point.x - old.x, point.y - old.y) / dt
            forward_speed = max(0, old.z - point.z) / dt
            speed = max(planar_speed, forward_speed * .65)
            if speed >= self.punch_speed and math.hypot(point.x - self.mole.x, point.y - self.mole.y) <= .105:
                self.score += 1
                self.last_hit[hand] = now
                hit = hand
                self.spawn(now)
                break
        for hand in set(self.previous) - set(wrists):
            del self.previous[hand]
        return hit

    def draw(self, canvas, width, height):
        """Draw this game's target; the launcher only draws camera and pose."""
        if self.mole is None or self.paused_at is not None:
            return
        x, y = self.mole.x * width, self.mole.y * height
        canvas.create_oval(x-65, y+35, x+65, y+68, fill="#392b2c", outline="#f8c66a", width=3)
        canvas.create_oval(x-47, y-46, x+47, y+49, fill="#b8794d", outline="#ffdf9b", width=3)
        canvas.create_oval(x-24, y-12, x-14, y-2, fill="#19222e", outline="")
        canvas.create_oval(x+14, y-12, x+24, y-2, fill="#19222e", outline="")
        canvas.create_oval(x-9, y+9, x+9, y+22, fill="#efaa9a", outline="")
        canvas.create_arc(x-19, y+13, x+19, y+35, start=200, extent=140, style="arc", outline="#553928", width=2)


GAMES = {WhackAMole.title: WhackAMole}
