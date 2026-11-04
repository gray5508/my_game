import * as THREE from "three";
import { HIT_Y, TRAVEL, WINDOW } from "./logic.js";

type Point = { x: number; y: number; z: number; visibility?: number } | null;
type Note = { id: string; side: string; at: number; state: string };
type Session = { startAt: number; notes: Note[] };

const CYAN = 0x59f3e5;
const PINK = 0xff5e96;
const CAMERA_Z = 11;
const PAD_Z = -3;
const up = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

function material(color: number, emissive = color, intensity = 0.4) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.35,
    roughness: 0.28,
  });
}

function noteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 168px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♪", 124, 127);
  return new THREE.CanvasTexture(canvas);
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42.3, 1, 0.1, 100);
  lastRender = 0;
  rig = new THREE.Group();
  torso: THREE.Mesh | null = null;
  joints = new Map<number, THREE.Mesh>();
  bones: { a: number; b: number; mesh: THREE.Mesh }[] = [];
  notes = new Map<string, THREE.Group>();
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  pads: { L: THREE.Group; R: THREE.Group };
  rails: { side: "L" | "R"; offset: number; line: THREE.Line }[] = [];
  rings: THREE.Mesh[] = [];
  pose: Point[] = [];
  poseAt = 0;
  targets = { L: { x: -1.4, y: HIT_Y }, R: { x: 1.4, y: HIT_Y } };
  hitPulse = { L: 0, R: 0 };
  playing = false;
  noteGlyph = noteTexture();
  host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.domElement.className = "stage-canvas";
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x080e20);
    this.scene.fog = new THREE.FogExp2(0x080e20, 0.025);
    this.scene.add(new THREE.AmbientLight(0xa6d3ff, 1.2));
    const key = new THREE.PointLight(CYAN, 65, 14);
    key.position.set(-3, 3, 4);
    this.scene.add(key);
    const rim = new THREE.PointLight(PINK, 60, 14);
    rim.position.set(3, 1, -2);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 35),
      new THREE.MeshStandardMaterial({
        color: 0x0b1727,
        metalness: 0.45,
        roughness: 0.65,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -3.15, -6);
    this.scene.add(floor);
    const grid = new THREE.GridHelper(30, 30, 0x2c8790, 0x1b4054);
    grid.position.set(0, -3.12, -6);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.38;
    this.scene.add(grid);
    for (const z of [-2, -6, -10, -14]) {
      const frame = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-4.2, -3.05, z),
          new THREE.Vector3(-4.2, 3.2, z),
          new THREE.Vector3(4.2, 3.2, z),
          new THREE.Vector3(4.2, -3.05, z),
        ]),
        new THREE.LineBasicMaterial({
          color: z % 4 ? CYAN : PINK,
          transparent: true,
          opacity: z === -2 ? 0.28 : 0.16,
        }),
      );
      this.scene.add(frame);
    }
    for (const x of [-3.1, 3.1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.018, 22),
        new THREE.MeshBasicMaterial({ color: x < 0 ? CYAN : PINK }),
      );
      strip.position.set(x, -3.08, -6);
      this.scene.add(strip);
    }
    for (const radius of [2.55, 3.45, 4.45]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.018, 8, 128),
        new THREE.MeshBasicMaterial({
          color: CYAN,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      ring.position.z = -7;
      this.rings.push(ring);
      this.scene.add(ring);
    }

    this.makeRig();
    this.rig.visible = false;
    this.pads = { L: this.makePad("L"), R: this.makePad("R") };
    this.makeRails();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.position.set(0.9, 5.6, CAMERA_Z);
    this.camera.lookAt(0, -0.2, -3);
    this.camera.updateProjectionMatrix();
    this.syncPads();
  }

  private syncPads() {
    if (!this.pads) return;
    for (const side of ["L", "R"] as const) {
      const target = this.targets[side];
      this.pads[side].position.set(target.x, target.y, PAD_Z);
    }
    for (const { side, offset, line } of this.rails) {
      const target = this.targets[side];
      const sign = side === "L" ? -1 : 1;
      const positions = line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      positions.setXYZ(0, target.x, target.y + offset, PAD_Z);
      positions.setXYZ(1, sign * 2.3, target.y + offset + 0.2, -11);
      positions.needsUpdate = true;
    }
  }

  private makeRails() {
    for (const side of ["L", "R"] as const) {
      for (const offset of [-0.52, 0.52]) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]),
          new THREE.LineBasicMaterial({
            color: side === "L" ? CYAN : PINK,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
          }),
        );
        this.scene.add(line);
        this.rails.push({ side, offset, line });
      }
    }
  }

  makePad(side: "L" | "R") {
    const color = side === "L" ? CYAN : PINK;
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CircleGeometry(0.68, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      }),
    );
    group.add(base);
    for (const radius of [0.54, 0.72]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(
          radius,
          radius === 0.54 ? 0.055 : 0.016,
          10,
          64,
        ),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: radius === 0.54 ? 0.9 : 0.4,
        }),
      );
      group.add(ring);
    }
    group.position.set(this.targets[side].x, this.targets[side].y, PAD_Z);
    this.scene.add(group);
    return group;
  }

  makeRig() {
    const body = material(0x273851, CYAN, 0.16);
    const limb = material(0x9fefff, CYAN, 0.65);
    const glove = material(0xff657f, PINK, 1.3);
    const head = material(0xd7efff, CYAN, 0.38);
    const boneDefs: [number, number, number, THREE.Material][] = [
      [11, 12, 0.18, body],
      [11, 13, 0.11, limb],
      [13, 15, 0.095, limb],
      [12, 14, 0.11, limb],
      [14, 16, 0.095, limb],
      [11, 23, 0.19, body],
      [12, 24, 0.19, body],
      [23, 24, 0.16, body],
      [23, 25, 0.13, limb],
      [25, 27, 0.11, limb],
      [24, 26, 0.13, limb],
      [26, 28, 0.11, limb],
    ];
    for (const [a, b, radius, mat] of boneDefs) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 1, 12),
        mat,
      );
      this.bones.push({ a, b, mesh });
      this.rig.add(mesh);
    }
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.28), body);
    const badgeCanvas = document.createElement("canvas");
    badgeCanvas.width = badgeCanvas.height = 256;
    const badgeContext = badgeCanvas.getContext("2d")!;
    badgeContext.fillStyle = "#77f9e9";
    badgeContext.fillRect(29, 36, 198, 5);
    badgeContext.fillRect(29, 217, 198, 5);
    badgeContext.fillRect(121, 62, 14, 132);
    badgeContext.fillRect(50, 79, 57, 8);
    badgeContext.fillRect(149, 79, 57, 8);
    badgeContext.fillRect(61, 168, 50, 7);
    badgeContext.fillRect(145, 168, 50, 7);
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.82),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(badgeCanvas),
        transparent: true,
      }),
    );
    badge.position.z = 0.15;
    this.torso.add(badge);
    const backPack = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.62, 0.13),
      material(0x17394a, CYAN, 0.3),
    );
    backPack.position.set(0, 0.03, 0.23);
    this.torso.add(backPack);
    badge.position.z = 0.31;
    this.rig.add(this.torso);
    for (const index of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const radius =
        index === 0 ? 0.4 : index === 15 || index === 16 ? 0.3 : 0.135;
      const mat =
        index === 0 ? head : index === 15 || index === 16 ? glove : limb;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 22, 16),
        mat,
      );
      this.joints.set(index, mesh);
      this.rig.add(mesh);
    }
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.51, 0.13, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x10283b }),
    );
    visor.position.set(0, 0.04, -0.36);
    this.joints.get(0)!.add(visor);
    const rearHelmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 22, 16),
      material(0x214759, CYAN, 0.2),
    );
    rearHelmet.scale.set(1, 1, 0.55);
    rearHelmet.position.set(0, 0.04, 0.2);
    this.joints.get(0)!.add(rearHelmet);
    const backStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.08),
      new THREE.MeshBasicMaterial({ color: CYAN }),
    );
    backStripe.position.set(0, 0.09, 0.38);
    this.joints.get(0)!.add(backStripe);
    this.scene.add(this.rig);
  }

  setPose(points: Point[], at: number) {
    this.pose = points;
    this.poseAt = at;
    for (const [side, index, sign] of [
      ["L", 15, -1],
      ["R", 16, 1],
    ] as const) {
      const wrist = points[index];
      if (!wrist) continue;
      const target = this.targets[side];
      const follow = this.playing ? 0.025 : 0.08;
      const nextX = sign * clamp(Math.abs(wrist.x + sign * 0.48), 1.05, 1.8);
      target.x += (nextX - target.x) * follow;
      target.y += (clamp(wrist.y + 0.12, -0.45, 1.4) - target.y) * follow;
    }
    this.syncPads();
  }

  private rigPoints(now: number) {
    const idle = new Map<number, THREE.Vector3>([
      [0, new THREE.Vector3(0, 2.25, 0)],
      [11, new THREE.Vector3(-0.83, 1.43, 0)],
      [12, new THREE.Vector3(0.83, 1.43, 0)],
      [13, new THREE.Vector3(-1.25, 0.55, -0.1)],
      [14, new THREE.Vector3(1.25, 0.55, -0.1)],
      [15, new THREE.Vector3(-1.45, -0.16 + Math.sin(now * 2) * 0.08, -0.4)],
      [16, new THREE.Vector3(1.45, -0.16 + Math.sin(now * 2 + 1) * 0.08, -0.4)],
      [23, new THREE.Vector3(-0.55, -0.55, 0)],
      [24, new THREE.Vector3(0.55, -0.55, 0)],
      [25, new THREE.Vector3(-0.56, -1.75, 0)],
      [26, new THREE.Vector3(0.56, -1.75, 0)],
      [27, new THREE.Vector3(-0.65, -2.95, 0.2)],
      [28, new THREE.Vector3(0.65, -2.95, 0.2)],
    ]);
    if (now - this.poseAt > 1 || !this.pose[11] || !this.pose[12]) return idle;
    for (const index of idle.keys()) {
      const p = this.pose[index];
      if (!p) continue;
      idle.set(index, new THREE.Vector3(p.x, p.y, p.z));
    }
    return idle;
  }

  private placeBone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    const delta = new THREE.Vector3().subVectors(b, a);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, delta.clone().normalize());
    mesh.scale.set(1, delta.length(), 1);
  }

  private makeNote(note: Note) {
    const color = note.side === "L" ? CYAN : PINK;
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.CircleGeometry(0.48, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.78,
        }),
      ),
    );
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.055, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    group.add(rim);
    const glyph = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 0.65),
      new THREE.MeshBasicMaterial({
        map: this.noteGlyph,
        transparent: true,
        depthWrite: false,
      }),
    );
    glyph.position.z = 0.05;
    group.add(glyph);
    this.scene.add(group);
    this.notes.set(note.id, group);
    return group;
  }

  hit(side: "L" | "R", impact?: { x: number; y: number }, scored = true) {
    const x = scored
      ? this.targets[side].x
      : (impact?.x ?? this.targets[side].x);
    const y = scored
      ? this.targets[side].y
      : (impact?.y ?? this.targets[side].y);
    if (scored) this.hitPulse[side] = 1;
    const color = scored ? (side === "L" ? CYAN : PINK) : 0x8fa3c7;
    for (let i = 0; i < (scored ? 22 : 7); i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.055 + Math.random() * 0.075, 0),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.set(x, y, scored ? PAD_Z : 0);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          Math.random() * 2,
        ),
        life: 0.6,
      });
    }
  }

  render(now: number, session: Session | null) {
    const dt = this.lastRender ? Math.min(now - this.lastRender, 0.05) : 0.016;
    this.lastRender = now;
    if (this.rig.visible) {
      const points = this.rigPoints(now);
      for (const [index, mesh] of this.joints)
        mesh.position.lerp(points.get(index)!, 1 - Math.exp(-dt * 14));
      for (const bone of this.bones)
        this.placeBone(
          bone.mesh,
          this.joints.get(bone.a)!.position,
          this.joints.get(bone.b)!.position,
        );
      if (this.torso) {
        const shoulders = this.joints
          .get(11)!
          .position.clone()
          .add(this.joints.get(12)!.position)
          .multiplyScalar(0.5);
        const hips = this.joints
          .get(23)!
          .position.clone()
          .add(this.joints.get(24)!.position)
          .multiplyScalar(0.5);
        this.placeBone(this.torso, hips, shoulders);
      }
      this.rig.rotation.y = Math.sin(now * 0.7) * 0.045;
    }
    this.rings.forEach((ring, i) => {
      ring.rotation.z = now * (i % 2 ? -0.07 : 0.05);
      (ring.material as THREE.MeshBasicMaterial).opacity =
        0.09 + 0.035 * Math.sin(now * 2 + i);
    });
    for (const side of ["L", "R"] as const) {
      const pad = this.pads[side];
      const pulse = session
        ? Math.max(
            0,
            ...session.notes
              .filter((n) => n.side === side && n.state === "pending")
              .map((n) => 1 - Math.abs(n.at - (now - session.startAt)) / 0.35),
          )
        : 0;
      const size = 1 + pulse * 0.14;
      pad.scale.setScalar(size + this.hitPulse[side] * 0.42);
      this.hitPulse[side] = Math.max(0, this.hitPulse[side] - dt * 4);
    }
    const visible = new Set<string>();
    if (session) {
      const elapsed = now - session.startAt;
      for (const note of session.notes) {
        const progress = 1 - (note.at - elapsed) / TRAVEL;
        if (
          note.state !== "pending" ||
          progress < 0 ||
          elapsed > note.at + WINDOW
        )
          continue;
        visible.add(note.id);
        const group = this.notes.get(note.id) || this.makeNote(note);
        const target = this.targets[note.side as "L" | "R"];
        const sign = note.side === "L" ? -1 : 1;
        const depth = Math.min(progress, 1);
        group.position.set(
          sign * 2.3 + (target.x - sign * 2.3) * depth,
          target.y + (1 - depth) * 0.2,
          -11 + depth * (PAD_Z + 11),
        );
        group.scale.setScalar(0.8 + 0.2 * depth + 0.06 * Math.sin(now * 9));
        group.rotation.z = sign * Math.sin(now * 4) * 0.13;
      }
    }
    for (const [id, mesh] of this.notes)
      if (!visible.has(id)) {
        this.scene.remove(mesh);
        this.notes.delete(id);
      }
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.multiplyScalar(0.94);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        p.life / 0.6,
      );
      p.mesh.scale.setScalar(Math.max(0.01, p.life / 0.6));
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
