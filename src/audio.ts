import { BEAT, makeChart } from "./logic.js";

export class SongAudio {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  noise: AudioBuffer | null = null;
  muted = false;

  async ready() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.46;
      this.master.connect(this.context.destination);
      this.noise = this.context.createBuffer(
        1,
        Math.floor(this.context.sampleRate * 0.22),
        this.context.sampleRate,
      );
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    await this.context.resume();
  }

  now() {
    return this.context?.currentTime ?? performance.now() / 1000;
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        value ? 0 : 0.46,
        this.context.currentTime,
        0.025,
      );
  }

  private tone(
    frequency: number,
    at: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    endFrequency?: number,
  ) {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    if (endFrequency)
      osc.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private hiss(at: number, volume: number, duration: number) {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    filter.type = "highpass";
    filter.frequency.value = 5500;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(at);
    source.stop(at + duration);
  }

  schedule(startAt: number) {
    const melody = [329.63, 392, 440, 523.25, 493.88, 440, 392, 329.63];
    for (let i = 0; i < 4; i++)
      this.tone(
        i === 3 ? 880 : 660,
        startAt - (3 - i) * BEAT,
        0.09,
        i === 3 ? 0.15 : 0.09,
      );
    for (let beat = 0; beat < 32; beat++) {
      const at = startAt + beat * BEAT;
      if (beat % 4 === 0 || beat % 4 === 2) {
        this.tone(150, at, 0.24, 0.36, "sine", 45);
      }
      if (beat % 4 === 1 || beat % 4 === 3) {
        this.hiss(at, 0.25, 0.11);
        this.tone(185, at, 0.08, 0.055, "triangle");
      }
      this.hiss(at, 0.065, 0.055);
      this.hiss(at + BEAT / 2, 0.04, 0.04);
      if (beat % 4 === 0)
        this.tone(
          [110, 130.81, 146.83, 130.81][Math.floor(beat / 4) % 4],
          at,
          BEAT * 1.5,
          0.13,
          "triangle",
        );
    }
    for (const note of makeChart()) {
      const pitch =
        melody[Math.floor(note.at / BEAT / 4) % melody.length] *
        (note.side === "R" ? 1.25 : 1);
      this.tone(pitch, startAt + note.at, 0.16, 0.055, "triangle");
    }
  }

  hit(grade: string) {
    if (!this.context) return;
    const at = this.context.currentTime;
    this.tone(grade === "PERFECT" ? 987.77 : 784, at, 0.18, 0.14, "sine");
    this.tone(
      grade === "PERFECT" ? 1480 : 1174,
      at + 0.035,
      0.15,
      0.075,
      "sine",
    );
  }
}
