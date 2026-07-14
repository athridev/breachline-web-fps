"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type Team = "attack" | "defend";
type Phase = "briefing" | "buy" | "live" | "roundEnd" | "matchEnd";
type Difficulty = "recruit" | "veteran" | "elite";

type Settings = {
  sensitivity: number;
  fov: number;
  volume: number;
  quality: "performance" | "balanced" | "ultra";
};

type MapDot = { id: string; x: number; z: number; team: Team; alive: boolean };
type FeedItem = { id: number; killer: string; victim: string; weapon: string; friendly: boolean };
type PlayerRow = { name: string; team: Team; kills: number; deaths: number; alive: boolean; isPlayer?: boolean };

type Snapshot = {
  phase: Phase;
  team: Team;
  health: number;
  armor: number;
  money: number;
  ammo: number;
  reserve: number;
  weapon: string;
  weaponId: string;
  roundTime: number;
  phaseTime: number;
  attackScore: number;
  defendScore: number;
  round: number;
  alive: boolean;
  bombPlanted: boolean;
  bombTime: number;
  bombSite: "A" | "B" | null;
  actionText: string;
  actionProgress: number;
  objective: string;
  feed: FeedItem[];
  dots: MapDot[];
  players: PlayerRow[];
  roundMessage: string;
  hitMarker: boolean;
  kills: number;
  deaths: number;
  ping: number;
};

type Weapon = {
  id: string;
  label: string;
  short: string;
  price: number;
  damage: number;
  fireRate: number;
  magazine: number;
  reserve: number;
  reload: number;
  spread: number;
  auto: boolean;
  pellets?: number;
  color: number;
  length: number;
  category: "primary" | "sidearm";
};

const WEAPONS: Record<string, Weapon> = {
  v9: { id: "v9", label: "V9 Sidearm", short: "V9", price: 0, damage: 29, fireRate: 0.22, magazine: 12, reserve: 48, reload: 1.35, spread: 0.012, auto: false, color: 0x2a3034, length: 0.46, category: "sidearm" },
  kestrel: { id: "kestrel", label: "Kestrel SMG", short: "KSTRL", price: 1250, damage: 24, fireRate: 0.078, magazine: 30, reserve: 90, reload: 1.75, spread: 0.027, auto: true, color: 0x2c3335, length: 0.68, category: "primary" },
  arclight: { id: "arclight", label: "Arclight Rifle", short: "ARCLT", price: 2700, damage: 37, fireRate: 0.105, magazine: 30, reserve: 90, reload: 2.15, spread: 0.015, auto: true, color: 0x343a3b, length: 0.88, category: "primary" },
  breach: { id: "breach", label: "Breach-12", short: "BR-12", price: 1900, damage: 17, fireRate: 0.82, magazine: 7, reserve: 28, reload: 2.6, spread: 0.065, auto: false, pellets: 8, color: 0x313638, length: 0.82, category: "primary" },
  spectre: { id: "spectre", label: "Spectre DMR", short: "SPCTR", price: 4200, damage: 92, fireRate: 0.9, magazine: 10, reserve: 30, reload: 2.75, spread: 0.003, auto: false, color: 0x1d2529, length: 1.05, category: "primary" },
};

const BOT_NAMES = ["KITE", "NOVA", "MERC", "ZERO", "RUNE", "HELIOS", "VIPER", "ROOK", "MICA", "SOL"];

const initialSnapshot: Snapshot = {
  phase: "briefing",
  team: "attack",
  health: 100,
  armor: 0,
  money: 3200,
  ammo: 30,
  reserve: 90,
  weapon: "Arclight Rifle",
  weaponId: "arclight",
  roundTime: 105,
  phaseTime: 12,
  attackScore: 0,
  defendScore: 0,
  round: 1,
  alive: true,
  bombPlanted: false,
  bombTime: 38,
  bombSite: null,
  actionText: "",
  actionProgress: 0,
  objective: "Plant the charge at A or B",
  feed: [],
  dots: [],
  players: [],
  roundMessage: "",
  hitMarker: false,
  kills: 0,
  deaths: 0,
  ping: 24,
};

type EngineApi = {
  start: (difficulty: Difficulty, training: boolean) => void;
  resume: () => void;
  buy: (id: string) => boolean;
  buyArmor: () => boolean;
  setWeapon: (slot: 1 | 2) => void;
  throwGrenade: (kind: "frag" | "smoke") => void;
  setBuyMenu: (open: boolean) => void;
  setTouch: (key: string, down: boolean) => void;
  setFire: (down: boolean) => void;
  touchLook: (dx: number, dy: number) => void;
};

type Bot = {
  id: string;
  name: string;
  team: Team;
  root: THREE.Group;
  health: number;
  alive: boolean;
  kills: number;
  deaths: number;
  fireCooldown: number;
  decisionCooldown: number;
  destination: THREE.Vector3;
  skill: number;
  carryingBomb: boolean;
  defuseProgress: number;
};

type Obstacle = { x: number; z: number; w: number; d: number; height: number; mesh: THREE.Mesh };

function formatClock(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function otherTeam(team: Team): Team {
  return team === "attack" ? "defend" : "attack";
}

export function BreachlineGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineApi | null>(null);
  const settingsRef = useRef<Settings>({ sensitivity: 0.82, fov: 76, volume: 0.55, quality: "balanced" });
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [difficulty, setDifficulty] = useState<Difficulty>("veteran");
  const [paused, setPaused] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [settings, setSettings] = useState<Settings>({ sensitivity: 0.82, fov: 76, volume: 0.55, quality: "balanced" });
  const [toast, setToast] = useState("");
  const [stats, setStats] = useState({ matches: 0, wins: 0, eliminations: 0 });
  const lookTouchRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem("breachline.settings");
      const savedStats = localStorage.getItem("breachline.stats");
      if (savedSettings) {
        const next = { ...settingsRef.current, ...JSON.parse(savedSettings) } as Settings;
        settingsRef.current = next;
        setSettings(next);
      }
      if (savedStats) setStats(JSON.parse(savedStats));
    } catch {
      // Local storage is an enhancement; the match remains fully playable without it.
    }
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    try { localStorage.setItem("breachline.settings", JSON.stringify(settings)); } catch { /* noop */ }
  }, [settings]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.domElement.className = "game-canvas";
    renderer.domElement.setAttribute("aria-label", "Breachline first-person game view");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7893a1);
    scene.fog = new THREE.FogExp2(0x83939a, 0.0095);

    const camera = new THREE.PerspectiveCamera(settingsRef.current.fov, mount.clientWidth / mount.clientHeight, 0.05, 180);
    camera.rotation.order = "YXZ";
    camera.position.set(-24, 1.68, 23);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.2, 0.52, 0.88);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(115, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x527486) },
          horizonColor: { value: new THREE.Color(0xe8c394) },
          bottomColor: { value: new THREE.Color(0x9d8b72) },
          offset: { value: 10 },
          exponent: { value: 0.72 },
        },
        vertexShader: "varying vec3 vWorldPosition; void main(){ vec4 worldPosition = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y; float upper = pow(max(h, 0.0), exponent); float lower = smoothstep(-0.35, 0.05, h); vec3 lowerMix = mix(bottomColor, horizonColor, lower); gl_FragColor = vec4(mix(lowerMix, topColor, upper), 1.0); }",
      }),
    );
    scene.add(sky);

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe0a6, fog: false }));
    sunDisc.position.set(-64, 42, 48);
    scene.add(sunDisc);

    const hemi = new THREE.HemisphereLight(0xd9efff, 0x4b4034, 1.36);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.55);
    sun.position.set(-22, 34, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x78a7bd, 0.72);
    fill.position.set(26, 12, -24);
    scene.add(fill);

    const textureLoader = new THREE.TextureLoader();
    const textureUrl = (name: string) => new URL(`./textures/${name}`, window.location.href).href;
    const tiledTexture = (name: string, x: number, y: number, color = true) => {
      const texture = textureLoader.load(textureUrl(name));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(x, y);
      texture.anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return texture;
    };
    const groundTexture = tiledTexture("ground-v2.avif", 11, 11);
    const groundBump = tiledTexture("ground-v2.avif", 11, 11, false);
    const concreteTexture = tiledTexture("concrete-v2.avif", 2.2, 2.2);
    const concreteBump = tiledTexture("concrete-v2.avif", 2.2, 2.2, false);
    const metalTexture = tiledTexture("metal-v2.avif", 1.5, 1.25);
    const metalBump = tiledTexture("metal-v2.avif", 1.5, 1.25, false);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb2aa9d, map: groundTexture, bumpMap: groundBump, bumpScale: 0.16, roughness: 0.91, metalness: 0.04 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(72, 72, 16, 16), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const paintMaterial = new THREE.MeshStandardMaterial({ color: 0xd7c49b, roughness: 0.96, transparent: true, opacity: 0.42, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const [x, z, w, d, rotation] of [[0, 0, 0.12, 54, 0], [-15, 11, 0.12, 18, 0], [16, -11, 0.12, 20, 0], [0, 0, 28, 0.12, 0]] as number[][]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paintMaterial);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = rotation;
      line.position.set(x, 0.018, z);
      scene.add(line);
    }

    const obstacles: Obstacle[] = [];
    const obstacleMeshes: THREE.Object3D[] = [];
    const addBox = (x: number, z: number, w: number, d: number, h: number, color: number, metal = 0.15) => {
      const isMetal = metal > 0.5;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color(isMetal ? 0xb9b9b2 : 0xd7d2c8), 0.68),
        map: isMetal ? metalTexture : concreteTexture,
        bumpMap: isMetal ? metalBump : concreteBump,
        bumpScale: isMetal ? 0.09 : 0.12,
        roughness: isMetal ? 0.48 : 0.86,
        metalness: isMetal ? 0.68 : 0.05,
      });
      const radius = Math.min(0.11, w * 0.025, d * 0.025, h * 0.025);
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), material);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      obstacles.push({ x, z, w, d, height: h, mesh });
      obstacleMeshes.push(mesh);
      return mesh;
    };

    addBox(0, -35, 72, 2, 5, 0x4d514f);
    addBox(0, 35, 72, 2, 5, 0x4d514f);
    addBox(-35, 0, 2, 72, 5, 0x4d514f);
    addBox(35, 0, 2, 72, 5, 0x4d514f);
    addBox(-18, 5, 10, 5, 4.5, 0x5a5e5c);
    addBox(-17, -17, 7, 6, 3.8, 0x6b665b);
    addBox(17, 16, 9, 5, 4.8, 0x565c5b);
    addBox(18, -7, 7, 7, 4.2, 0x67645c);
    addBox(0, 6, 4, 15, 3.5, 0x555c5c);
    addBox(2, -17, 4, 11, 3.5, 0x555c5c);
    addBox(-6, 23, 12, 3, 2.8, 0x6b5a48);
    addBox(8, 24, 7, 3, 2.8, 0x4d5960, 0.7);
    addBox(-7, -27, 9, 3, 2.8, 0x4d5960, 0.7);
    addBox(12, -26, 11, 3, 2.8, 0x6b5a48);
    addBox(-27, -3, 3, 10, 3.2, 0x6b5a48);
    addBox(28, 3, 3, 11, 3.2, 0x4d5960, 0.7);
    addBox(-10, -5, 3.2, 3.2, 2.1, 0x9b693b, 0.55);
    addBox(10, 7, 3.2, 3.2, 2.1, 0x9b693b, 0.55);
    addBox(-1, 27, 2.8, 2.8, 1.9, 0x715c40, 0.35);
    addBox(2, -29, 2.8, 2.8, 1.9, 0x715c40, 0.35);

    const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x656d6c, map: metalTexture, bumpMap: metalBump, bumpScale: 0.07, metalness: 0.78, roughness: 0.38 });
    for (const z of [-12, 13]) {
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), beamMaterial);
      const right = left.clone();
      const top = new THREE.Mesh(new THREE.BoxGeometry(12, 0.55, 0.55), beamMaterial);
      left.position.set(-6, 4, z);
      right.position.set(6, 4, z);
      top.position.set(0, 7.7, z);
      left.castShadow = right.castShadow = top.castShadow = true;
      scene.add(left, right, top);

      const catwalk = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.16, 1.5), beamMaterial);
      catwalk.position.set(0, 6.55, z);
      catwalk.castShadow = true;
      catwalk.receiveShadow = true;
      scene.add(catwalk);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 11.3, 8), beamMaterial);
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, 7.45, z + side * 0.68);
        scene.add(rail);
        for (let x = -5.5; x <= 5.5; x += 1.35) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 7), beamMaterial);
          post.position.set(x, 7.02, z + side * 0.68);
          scene.add(post);
        }
      }
    }

    const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7474, metalness: 0.82, roughness: 0.3 });
    const addPipe = (x: number, y: number, z: number, length: number, rotation: "x" | "z") => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, length, 14), pipeMaterial);
      if (rotation === "x") pipe.rotation.z = Math.PI / 2;
      else pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, y, z);
      pipe.castShadow = true;
      scene.add(pipe);
      for (const offset of [-length * 0.32, length * 0.32]) {
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 7, 14), pipeMaterial);
        if (rotation === "x") collar.rotation.y = Math.PI / 2;
        collar.position.set(x + (rotation === "x" ? offset : 0), y, z + (rotation === "z" ? offset : 0));
        scene.add(collar);
      }
    };
    addPipe(-18, 5.1, 2.7, 9, "x");
    addPipe(18, 4.8, -10.6, 8, "x");
    addPipe(31.2, 3.3, 8, 12, "z");
    addPipe(-31.2, 3.8, -10, 14, "z");

    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x9d8c72, map: concreteTexture, bumpMap: concreteBump, bumpScale: 0.08, roughness: 0.84, metalness: 0.04 });
    for (const [x, z, rotation] of [[-21, 14, 0.1], [-22.4, 14.5, -0.2], [22, -17, 0.14], [13, 10, -0.1], [-12, -11, 0.2]] as number[][]) {
      const pallet = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.72, 0.9, 2, 0.055), crateMaterial);
        crate.position.set((i % 2) * 1.05, 0.38 + Math.floor(i / 2) * 0.74, 0);
        crate.castShadow = true;
        crate.receiveShadow = true;
        pallet.add(crate);
      }
      pallet.position.set(x, 0, z);
      pallet.rotation.y = rotation;
      scene.add(pallet);
    }

    const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x657071, map: metalTexture, roughness: 0.44, metalness: 0.62 });
    for (const [x, z] of [[-29, 20], [-28.4, 20.7], [27, -19], [15, 28], [-13, -29]] as number[][]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.92, 18, 1), barrelMaterial);
      barrel.position.set(x, 0.46, z);
      barrel.castShadow = true;
      scene.add(barrel);
      for (const y of [0.18, 0.74]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.025, 8, 18), pipeMaterial);
        band.rotation.x = Math.PI / 2;
        band.position.set(x, y, z);
        scene.add(band);
      }
    }

    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x776a59, roughness: 1, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const radius = 60 + (i % 3) * 6;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(8 + (i % 4) * 2.5, 14 + (i % 5) * 3, 7), mountainMaterial);
      mountain.position.set(Math.cos(angle) * radius, 4 + (i % 2) * 2, Math.sin(angle) * radius);
      mountain.rotation.y = angle * 1.7;
      scene.add(mountain);
    }

    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(850 * 3);
    for (let i = 0; i < 850; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 70;
      dustPositions[i * 3 + 1] = Math.random() * 8;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xe7c99f, size: 0.045, transparent: true, opacity: 0.4, depthWrite: false }));
    scene.add(dust);

    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 9, 6), beamMaterial);
    towerBase.position.set(28, 4.5, -27);
    towerBase.castShadow = true;
    scene.add(towerBase);
    const beacon = new THREE.PointLight(0xff5b22, 24, 22, 2);
    beacon.position.set(28, 10, -27);
    scene.add(beacon);

    for (const [x, y, z, color] of [[-17, 5.5, -17, 0xffa35e], [18, 5.8, 16, 0x8ed6ee], [-28, 4, 10, 0xffb170], [27, 4, -8, 0x91d4e8]] as number[][]) {
      const lamp = new THREE.PointLight(color, 8, 10, 2);
      lamp.position.set(x, y, z);
      scene.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color }));
      bulb.position.copy(lamp.position);
      scene.add(bulb);
    }

    const zoneA = new THREE.Vector3(-24, 0, -23);
    const zoneB = new THREE.Vector3(24, 0, 22);
    const addZone = (position: THREE.Vector3, color: number) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.15, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(position).setY(0.035);
      scene.add(ring);
      const light = new THREE.PointLight(color, 6, 9, 2);
      light.position.copy(position).setY(1.3);
      scene.add(light);
    };
    addZone(zoneA, 0xff7a2d);
    addZone(zoneB, 0x42b8cf);

    const gun = new THREE.Group();
    gun.position.set(0.34, -0.34, -0.58);
    camera.add(gun);
    scene.add(camera);
    let gunMeshes: THREE.Object3D[] = [];
    const buildGun = (weapon: Weapon) => {
      for (const child of gunMeshes) gun.remove(child);
      gunMeshes = [];
      const metal = new THREE.MeshPhysicalMaterial({ color: weapon.color, roughness: 0.27, metalness: 0.88, clearcoat: 0.12, clearcoatRoughness: 0.35 });
      const polymer = new THREE.MeshStandardMaterial({ color: 0x171d1f, roughness: 0.62, metalness: 0.18 });
      const rubber = new THREE.MeshStandardMaterial({ color: 0x101415, roughness: 0.9, metalness: 0.02 });
      const accent = new THREE.MeshStandardMaterial({ color: 0xd45b22, roughness: 0.46, metalness: 0.52 });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x243b43, emissive: 0x0d2c38, emissiveIntensity: 0.45, roughness: 0.05, metalness: 0.1, transmission: 0.22, transparent: true, opacity: 0.86 });
      const glove = new THREE.MeshStandardMaterial({ color: 0x242b2a, roughness: 0.92, metalness: 0.02 });
      const addPart = (mesh: THREE.Mesh) => { mesh.castShadow = true; gun.add(mesh); gunMeshes.push(mesh); return mesh; };

      const receiver = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.18, weapon.length * 0.58, 3, 0.025), metal));
      receiver.position.set(0, 0.01, -weapon.length * 0.2);
      const upper = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.07, weapon.length * 0.62, 2, 0.012), polymer));
      upper.position.set(0, 0.115, -weapon.length * 0.34);
      const handguard = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.088, weapon.length * 0.48, 12), polymer));
      handguard.rotation.x = Math.PI / 2;
      handguard.position.set(0, 0.012, -weapon.length * 0.72);
      const barrel = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.023, weapon.length * 0.72, 12), metal));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -weapon.length * 1.05);
      const muzzleBrake = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 12), metal));
      muzzleBrake.rotation.x = Math.PI / 2;
      muzzleBrake.position.set(0, 0.02, -weapon.length * 1.39);
      const grip = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.115, 0.29, 0.14, 2, 0.025), rubber));
      grip.rotation.x = -0.24;
      grip.position.set(0, -0.18, -0.05);
      const magazine = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.13, weapon.id === "v9" ? 0.24 : 0.32, 0.16, 2, 0.02), polymer));
      magazine.rotation.x = -0.15;
      magazine.position.set(0, -0.2, -weapon.length * 0.34);
      const rail = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, weapon.length * 0.55), metal));
      rail.position.set(0, 0.16, -weapon.length * 0.34);
      const stripe = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.028, 0.15), accent));
      stripe.position.set(0, 0.065, -weapon.length * 0.38);

      if (weapon.id !== "v9") {
        const stock = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.24, 0.34, 3, 0.035), polymer));
        stock.position.set(0, -0.02, weapon.length * 0.19);
        const butt = addPart(new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.3, 0.075, 2, 0.025), rubber));
        butt.position.set(0, -0.01, weapon.length * 0.38);
      }

      const rearSight = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.045), metal));
      rearSight.position.set(0, 0.2, -0.02);
      const frontSight = addPart(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.035), metal));
      frontSight.position.set(0, 0.17, -weapon.length * 0.86);

      if (weapon.id === "spectre" || weapon.id === "arclight") {
        const scope = addPart(new THREE.Mesh(new THREE.CylinderGeometry(weapon.id === "spectre" ? 0.085 : 0.06, weapon.id === "spectre" ? 0.095 : 0.065, weapon.id === "spectre" ? 0.38 : 0.22, 18), polymer));
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.235, -weapon.length * 0.28);
        const lens = addPart(new THREE.Mesh(new THREE.CircleGeometry(weapon.id === "spectre" ? 0.077 : 0.052, 18), glass));
        lens.position.set(0, 0.235, -weapon.length * 0.49);
      }
      if (weapon.id === "breach") {
        const pump = addPart(new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.28, 12), rubber));
        pump.rotation.x = Math.PI / 2;
        pump.position.set(0, -0.015, -weapon.length * 0.76);
      }

      const rightHand = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), glove));
      rightHand.scale.set(0.9, 1.2, 1.05);
      rightHand.position.set(0.04, -0.27, -0.02);
      const leftHand = addPart(new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), glove));
      leftHand.scale.set(1.05, 0.85, 1.25);
      leftHand.position.set(-0.04, -0.11, -weapon.length * 0.68);
      const rightForearm = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.42, 6, 10), glove));
      rightForearm.rotation.x = -0.72;
      rightForearm.position.set(0.09, -0.52, 0.12);
      const leftForearm = addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.44, 6, 10), glove));
      leftForearm.rotation.x = -1.04;
      leftForearm.rotation.z = 0.12;
      leftForearm.position.set(-0.22, -0.38, -weapon.length * 0.35);

      muzzle.position.set(0, 0.02, -weapon.length * 1.48);
    };

    const muzzle = new THREE.PointLight(0xff9a52, 0, 4, 2);
    muzzle.position.set(0, 0.04, -1);
    gun.add(muzzle);

    const audio = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const sound = (kind: "shot" | "hit" | "step" | "plant" | "explode" | "empty") => {
      if (settingsRef.current.volume <= 0 || audio.state === "suspended") return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      const config = {
        shot: [92, 0.055, "sawtooth"], hit: [620, 0.045, "square"], step: [58, 0.03, "sine"],
        plant: [880, 0.12, "square"], explode: [42, 0.32, "sawtooth"], empty: [210, 0.035, "square"],
      } as const;
      const [frequency, duration, type] = config[kind];
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * 0.45), now + duration);
      gain.gain.setValueAtTime(settingsRef.current.volume * (kind === "explode" ? 0.16 : 0.07), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + duration);
    };

    const bots: Bot[] = [];
    const createBotModel = (team: Team, id: string) => {
      const group = new THREE.Group();
      group.userData.botId = id;
      const uniform = new THREE.MeshStandardMaterial({ color: team === "attack" ? 0x75402c : 0x294c55, roughness: 0.86, metalness: 0.04 });
      const fabric = new THREE.MeshStandardMaterial({ color: 0x242a29, roughness: 0.94, metalness: 0.01 });
      const armor = new THREE.MeshStandardMaterial({ color: 0x181e1f, roughness: 0.58, metalness: 0.34 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x252d2f, roughness: 0.29, metalness: 0.82 });
      const skin = new THREE.MeshStandardMaterial({ color: 0x80634f, roughness: 0.92 });
      const lens = new THREE.MeshPhysicalMaterial({ color: 0x1b3b44, emissive: 0x123039, emissiveIntensity: 0.24, metalness: 0.35, roughness: 0.08, transmission: 0.18, transparent: true, opacity: 0.9 });

      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.48, 6, 12), uniform);
      torso.scale.z = 0.72;
      torso.position.y = 1.23;
      torso.userData.uniform = true;
      const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.27, 0.3, 2, 0.06), fabric);
      pelvis.position.y = 0.82;
      const vest = new THREE.Mesh(new RoundedBoxGeometry(0.63, 0.55, 0.39, 3, 0.055), armor);
      vest.position.set(0, 1.29, -0.03);
      const frontPlate = new THREE.Mesh(new RoundedBoxGeometry(0.43, 0.38, 0.075, 2, 0.025), armor);
      frontPlate.position.set(0, 1.32, -0.22);
      const backpack = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.55, 0.2, 2, 0.04), fabric);
      backpack.position.set(0, 1.28, 0.25);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.16, 10), skin);
      neck.position.y = 1.66;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 14), skin);
      head.scale.z = 0.9;
      head.position.y = 1.83;
      head.userData.part = "head";
      const balaclava = new THREE.Mesh(new THREE.SphereGeometry(0.211, 18, 14, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.66), fabric);
      balaclava.position.set(0, 1.82, -0.005);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.232, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.57), armor);
      helmet.scale.z = 1.04;
      helmet.position.y = 1.88;
      const helmetRail = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.022, 7, 18, Math.PI * 1.12), metal);
      helmetRail.rotation.x = Math.PI / 2;
      helmetRail.position.set(0, 1.89, -0.01);
      const goggles = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.075, 0.035, 2, 0.016), lens);
      goggles.position.set(0, 1.85, -0.193);
      goggles.userData.part = "head";

      const legA = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.45, 5, 9), fabric);
      const legB = legA.clone();
      legA.position.set(-0.15, 0.47, 0);
      legB.position.set(0.15, 0.47, 0);
      const bootA = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.16, 0.35, 2, 0.04), armor);
      const bootB = bootA.clone();
      bootA.position.set(-0.15, 0.11, -0.06);
      bootB.position.set(0.15, 0.11, -0.06);
      const kneeA = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.18, 0.08, 2, 0.025), armor);
      const kneeB = kneeA.clone();
      kneeA.position.set(-0.15, 0.5, -0.13);
      kneeB.position.set(0.15, 0.5, -0.13);

      const armA = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.43, 5, 9), uniform);
      const armB = armA.clone();
      armA.userData.uniform = true;
      armB.userData.uniform = true;
      armA.rotation.x = -0.82;
      armB.rotation.x = -1.02;
      armA.rotation.z = 0.2;
      armB.rotation.z = -0.3;
      armA.position.set(-0.34, 1.26, -0.16);
      armB.position.set(0.34, 1.24, -0.21);
      const handA = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), fabric);
      const handB = handA.clone();
      handA.position.set(-0.24, 1.09, -0.43);
      handB.position.set(0.25, 1.12, -0.48);

      const weaponBody = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.14, 0.62, 2, 0.018), metal);
      weaponBody.position.set(0.09, 1.2, -0.49);
      weaponBody.rotation.x = -0.08;
      const weaponBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 10), metal);
      weaponBarrel.rotation.x = Math.PI / 2;
      weaponBarrel.position.set(0.09, 1.22, -1.02);
      const weaponStock = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.21, 0.24, 2, 0.025), armor);
      weaponStock.position.set(0.09, 1.2, -0.12);
      const weaponMag = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.25, 0.13, 2, 0.018), armor);
      weaponMag.rotation.x = -0.18;
      weaponMag.position.set(0.09, 1.03, -0.48);

      for (const x of [-0.19, 0, 0.19]) {
        const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.17, 0.09, 2, 0.018), fabric);
        pouch.position.set(x, 1.12, -0.26);
        group.add(pouch);
      }

      group.userData.legA = legA;
      group.userData.legB = legB;
      group.userData.armA = armA;
      group.userData.armB = armB;
      group.add(torso, pelvis, vest, frontPlate, backpack, neck, head, balaclava, helmet, helmetRail, goggles, legA, legB, bootA, bootB, kneeA, kneeB, armA, armB, handA, handB, weaponBody, weaponBarrel, weaponStock, weaponMag);
      group.traverse((child) => {
        child.userData.botId = id;
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(group);
      return group;
    };

    for (let i = 0; i < 9; i++) {
      const team: Team = i < 4 ? "attack" : "defend";
      const id = `bot-${i}`;
      const root = createBotModel(team, id);
      bots.push({ id, name: BOT_NAMES[i], team, root, health: 100, alive: true, kills: 0, deaths: 0, fireCooldown: 0, decisionCooldown: 0, destination: new THREE.Vector3(), skill: 0.62, carryingBomb: false, defuseProgress: 0 });
    }

    let screenActive = false;
    let trainingMode = false;
    let playerTeam: Team = "attack";
    let playerHealth = 100;
    let playerArmor = 0;
    let playerAlive = true;
    let playerMoney = 3200;
    let playerKills = 0;
    let playerDeaths = 0;
    let attackScore = 0;
    let defendScore = 0;
    let roundNumber = 1;
    let phase: Phase = "briefing";
    let phaseTime = 12;
    let roundTime = 105;
    let roundMessage = "";
    let roundEndQueued = false;
    let weaponId = "v9";
    let primaryId: string | null = null;
    let ammo: Record<string, { clip: number; reserve: number }> = { v9: { clip: 12, reserve: 48 } };
    let reloadingUntil = 0;
    let nextShotAt = 0;
    let firing = false;
    let grenadeFrag = 1;
    let grenadeSmoke = 1;
    let yaw = Math.PI * 0.76;
    let pitch = 0;
    const velocity = new THREE.Vector3();
    let bob = 0;
    let recoil = 0;
    let jumpHeight = 0;
    let jumpVelocity = 0;
    let aiming = false;
    let stepTimer = 0;
    let actionProgress = 0;
    let actionText = "";
    let hitMarkerUntil = 0;
    let damageFlashUntil = 0;
    let feed: FeedItem[] = [];
    let feedId = 0;
    let playerCarryingBomb = true;
    let bombPlanted = false;
    let bombSite: "A" | "B" | null = null;
    const bombPosition = new THREE.Vector3();
    let bombTime = 38;
    let bombBeepAt = 0;
    let botPlantProgress = 0;
    const keys = new Set<string>();
    const touchKeys = new Set<string>();
    const raycaster = new THREE.Raycaster();
    const clock = new THREE.Clock();
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
    const smokes: { mesh: THREE.Mesh; life: number }[] = [];
    let intentionalUnlock = false;
    let buyOpen = false;

    const bombMesh = new THREE.Group();
    const bombCase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.38), new THREE.MeshStandardMaterial({ color: 0x292d2c, roughness: 0.58, metalness: 0.6 }));
    const bombLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4f28 }));
    bombLed.position.set(0.18, 0.13, 0.08);
    bombMesh.add(bombCase, bombLed);
    bombMesh.visible = false;
    scene.add(bombMesh);

    const spawnByTeam = (team: Team, index: number) => {
      const baseX = team === "attack" ? -27 : 27;
      const baseZ = team === "attack" ? 27 : -27;
      return new THREE.Vector3(baseX + (index % 3) * 1.5, 0, baseZ + Math.floor(index / 3) * 1.5);
    };

    const collides = (x: number, z: number, radius = 0.42) => {
      if (x < -33 || x > 33 || z < -33 || z > 33) return true;
      return obstacles.some((o) => Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius);
    };

    const segmentHitsRect = (a: THREE.Vector3, b: THREE.Vector3, o: Obstacle) => {
      const steps = Math.ceil(a.distanceTo(b) / 1.4);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = THREE.MathUtils.lerp(a.x, b.x, t);
        const z = THREE.MathUtils.lerp(a.z, b.z, t);
        if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) return true;
      }
      return false;
    };

    const lineOfSight = (a: THREE.Vector3, b: THREE.Vector3) => {
      if (obstacles.some((o) => o.height > 1.2 && segmentHitsRect(a, b, o))) return false;
      const ab = b.clone().sub(a);
      const abLengthSq = Math.max(0.001, ab.lengthSq());
      return !smokes.some((smoke) => {
        const t = clamp(smoke.mesh.position.clone().sub(a).dot(ab) / abLengthSq, 0, 1);
        const closest = a.clone().addScaledVector(ab, t);
        return closest.distanceTo(smoke.mesh.position) < 3.5;
      });
    };

    const addFeed = (killer: string, victim: string, weapon: string, friendly = false) => {
      feedId += 1;
      feed = [{ id: feedId, killer, victim, weapon, friendly }, ...feed].slice(0, 5);
    };

    const currentWeapon = () => WEAPONS[weaponId];
    const equip = (id: string) => {
      if (!ammo[id]) return;
      weaponId = id;
      reloadingUntil = 0;
      buildGun(WEAPONS[id]);
    };

    const setDifficulty = (value: Difficulty) => {
      const skill = value === "recruit" ? 0.43 : value === "veteran" ? 0.64 : 0.82;
      bots.forEach((bot) => { bot.skill = skill + (Math.random() - 0.5) * 0.12; });
    };

    const beginRound = () => {
      roundEndQueued = false;
      playerTeam = trainingMode ? "attack" : roundNumber <= 6 ? "attack" : "defend";
      phase = "buy";
      phaseTime = trainingMode ? 6 : 12;
      roundTime = trainingMode ? 180 : 105;
      roundMessage = "";
      playerHealth = 100;
      playerAlive = true;
      playerArmor = Math.min(playerArmor, 100);
      playerCarryingBomb = playerTeam === "attack";
      bombPlanted = false;
      bombSite = null;
      bombTime = 38;
      bombBeepAt = 37;
      botPlantProgress = 0;
      bombMesh.visible = false;
      actionProgress = 0;
      actionText = "";
      grenadeFrag = 1;
      grenadeSmoke = 1;
      camera.position.copy(spawnByTeam(playerTeam, 0)).setY(1.68);
      yaw = playerTeam === "attack" ? Math.PI * 0.76 : -Math.PI * 0.24;
      pitch = 0;
      jumpHeight = 0;
      jumpVelocity = 0;
      aiming = false;
      velocity.set(0, 0, 0);
      bots.forEach((bot, index) => {
        bot.team = index < 4 ? playerTeam : otherTeam(playerTeam);
        bot.root.traverse((child) => {
          if (child.userData.uniform && child instanceof THREE.Mesh) {
            (child.material as THREE.MeshStandardMaterial).color.setHex(bot.team === "attack" ? 0xb3572f : 0x326a78);
          }
        });
        bot.health = 100;
        bot.alive = true;
        bot.root.visible = true;
        bot.fireCooldown = 0.5 + Math.random();
        bot.decisionCooldown = 0;
        bot.defuseProgress = 0;
        bot.carryingBomb = false;
        const teamIndex = index < 4 ? index : index - 4;
        bot.root.position.copy(spawnByTeam(bot.team, teamIndex + (bot.team === playerTeam ? 1 : 0)));
        bot.destination.copy(bot.team === "attack" ? (index % 2 ? zoneA : zoneB) : (index % 2 ? zoneA : zoneB));
      });
      if (trainingMode) {
        bots.filter((b) => b.team === "attack").forEach((b) => { b.root.visible = false; b.alive = false; });
        bots.filter((b) => b.team === "defend").forEach((b, i) => { if (i > 3) { b.root.visible = false; b.alive = false; } });
      }
      if (!ammo.v9) ammo.v9 = { clip: WEAPONS.v9.magazine, reserve: WEAPONS.v9.reserve };
      equip(primaryId ?? "v9");
    };

    const finishMatch = (winningTeam: Team) => {
      phase = "matchEnd";
      roundMessage = winningTeam === playerTeam ? "MISSION ACCOMPLISHED" : "MISSION FAILED";
      document.exitPointerLock?.();
      try {
        const raw = localStorage.getItem("breachline.stats");
        const saved = raw ? JSON.parse(raw) : { matches: 0, wins: 0, eliminations: 0 };
        const next = { matches: saved.matches + 1, wins: saved.wins + (winningTeam === playerTeam ? 1 : 0), eliminations: saved.eliminations + playerKills };
        localStorage.setItem("breachline.stats", JSON.stringify(next));
        setStats(next);
      } catch { /* noop */ }
    };

    const endRound = (winner: Team, reason: string) => {
      if (roundEndQueued || phase === "matchEnd") return;
      roundEndQueued = true;
      phase = "roundEnd";
      phaseTime = 4.8;
      roundMessage = `${winner === "attack" ? "STRIKERS" : "WARDENS"} WIN · ${reason}`;
      if (winner === "attack") attackScore += 1;
      else defendScore += 1;
      playerMoney = Math.min(16000, playerMoney + (winner === playerTeam ? 3250 : 1900));
      if (!trainingMode && (attackScore >= 7 || defendScore >= 7)) {
        window.setTimeout(() => finishMatch(attackScore >= 7 ? "attack" : "defend"), 2300);
      }
    };

    const damageBot = (bot: Bot, damage: number, attackerName: string, weapon: string, attackerTeam: Team) => {
      if (!bot.alive) return;
      bot.health -= damage;
      if (attackerName === "YOU") {
        hitMarkerUntil = performance.now() + 110;
        sound("hit");
      }
      if (bot.health <= 0) {
        bot.alive = false;
        bot.root.visible = false;
        bot.deaths += 1;
        addFeed(attackerName, bot.name, weapon, attackerTeam === bot.team);
        if (attackerName === "YOU") {
          playerKills += 1;
          playerMoney = Math.min(16000, playerMoney + (attackerTeam === bot.team ? 0 : 300));
        } else {
          const killer = bots.find((b) => b.name === attackerName);
          if (killer) killer.kills += 1;
        }
        if (bot.carryingBomb) {
          const nextCarrier = bots.find((b) => b.team === "attack" && b.alive);
          if (nextCarrier) nextCarrier.carryingBomb = true;
        }
      }
    };

    const damagePlayer = (damage: number, attacker: Bot) => {
      if (!playerAlive) return;
      const absorbed = Math.min(playerArmor, damage * 0.42);
      playerArmor -= absorbed;
      playerHealth -= damage - absorbed;
      damageFlashUntil = performance.now() + 150;
      if (playerHealth <= 0) {
        playerHealth = 0;
        playerAlive = false;
        playerDeaths += 1;
        attacker.kills += 1;
        addFeed(attacker.name, "YOU", "KSTRL");
        if (playerCarryingBomb) {
          playerCarryingBomb = false;
          const nextCarrier = bots.find((b) => b.team === "attack" && b.alive);
          if (nextCarrier) nextCarrier.carryingBomb = true;
        }
      }
    };

    const spawnImpact = (point: THREE.Vector3, color = 0xff9a52) => {
      for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), new THREE.MeshBasicMaterial({ color }));
        mesh.position.copy(point);
        scene.add(mesh);
        particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 2.2, Math.random() * 1.6, (Math.random() - 0.5) * 2.2), life: 0.28 + Math.random() * 0.22 });
      }
    };

    const fireShot = () => {
      if (!screenActive || !playerAlive || phase === "roundEnd" || phase === "matchEnd") return;
      const now = performance.now() / 1000;
      const weapon = currentWeapon();
      if (now < nextShotAt || now < reloadingUntil) return;
      const mag = ammo[weapon.id];
      if (!mag || mag.clip <= 0) {
        sound("empty");
        nextShotAt = now + 0.25;
        return;
      }
      if (!weapon.auto) firing = false;
      mag.clip -= 1;
      nextShotAt = now + weapon.fireRate;
      recoil = Math.min(0.16, recoil + (weapon.id === "spectre" ? 0.09 : 0.035));
      pitch = clamp(pitch + weapon.spread * 0.75, -1.2, 1.2);
      muzzle.intensity = 14;
      window.setTimeout(() => { muzzle.intensity = 0; }, 38);
      sound("shot");

      const pellets = weapon.pellets ?? 1;
      for (let pellet = 0; pellet < pellets; pellet++) {
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const movementSpread = velocity.length() > 2 ? weapon.spread * 1.8 : weapon.spread;
        direction.x += (Math.random() - 0.5) * movementSpread;
        direction.y += (Math.random() - 0.5) * movementSpread;
        direction.z += (Math.random() - 0.5) * movementSpread;
        direction.normalize();
        raycaster.set(camera.position, direction);
        raycaster.far = 90;
        const botTargets = bots.filter((b) => b.alive && b.team !== playerTeam).map((b) => b.root);
        const botHits = raycaster.intersectObjects(botTargets, true);
        const wallHits = raycaster.intersectObjects(obstacleMeshes, false);
        const botHit = botHits[0];
        const wallHit = wallHits[0];
        if (botHit && (!wallHit || botHit.distance < wallHit.distance)) {
          const botId = botHit.object.userData.botId as string;
          const bot = bots.find((b) => b.id === botId);
          if (bot) {
            const headshot = botHit.object.userData.part === "head";
            damageBot(bot, weapon.damage * (headshot ? 2.3 : 1), "YOU", weapon.short, playerTeam);
            spawnImpact(botHit.point, headshot ? 0xff4d32 : 0xffa95a);
          }
        } else if (wallHit) {
          spawnImpact(wallHit.point, 0xffc58b);
        }
      }
    };

    const reload = () => {
      const weapon = currentWeapon();
      const mag = ammo[weapon.id];
      const now = performance.now() / 1000;
      if (!mag || mag.clip >= weapon.magazine || mag.reserve <= 0 || now < reloadingUntil) return;
      reloadingUntil = now + weapon.reload;
      window.setTimeout(() => {
        const needed = weapon.magazine - mag.clip;
        const amount = Math.min(needed, mag.reserve);
        mag.clip += amount;
        mag.reserve -= amount;
      }, weapon.reload * 1000);
    };

    const explodeAt = (position: THREE.Vector3) => {
      sound("explode");
      const flash = new THREE.PointLight(0xff6b2b, 60, 18, 2);
      flash.position.copy(position).setY(1);
      scene.add(flash);
      window.setTimeout(() => scene.remove(flash), 180);
      bots.filter((b) => b.alive && b.root.position.distanceTo(position) < 8).forEach((bot) => {
        const distance = bot.root.position.distanceTo(position);
        damageBot(bot, Math.max(12, 108 - distance * 12), "YOU", "FRAG", playerTeam);
      });
      if (camera.position.distanceTo(position) < 8 && playerAlive) {
        const distance = camera.position.distanceTo(position);
        playerHealth = Math.max(1, playerHealth - Math.max(5, 75 - distance * 9));
      }
    };

    const throwGrenade = (kind: "frag" | "smoke") => {
      if (!playerAlive || phase !== "live") return;
      if ((kind === "frag" && grenadeFrag <= 0) || (kind === "smoke" && grenadeSmoke <= 0)) return;
      if (kind === "frag") grenadeFrag -= 1;
      else grenadeSmoke -= 1;
      const material = new THREE.MeshStandardMaterial({ color: kind === "frag" ? 0x424944 : 0x4d6c70, metalness: 0.65, roughness: 0.42 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), material);
      mesh.position.copy(camera.position).add(new THREE.Vector3(0, -0.18, 0));
      scene.add(mesh);
      const direction = new THREE.Vector3(0, 0.22, -1).applyQuaternion(camera.quaternion).normalize().multiplyScalar(12);
      let life = 1.7;
      const update = (dt: number) => {
        life -= dt;
        direction.y -= 9.8 * dt;
        const next = mesh.position.clone().addScaledVector(direction, dt);
        if (next.y < 0.13) { next.y = 0.13; direction.y *= -0.44; direction.multiplyScalar(0.78); }
        if (collides(next.x, next.z, 0.1)) { direction.x *= -0.55; direction.z *= -0.55; }
        else mesh.position.copy(next);
        if (life <= 0) {
          scene.remove(mesh);
          if (kind === "frag") explodeAt(mesh.position);
          else {
            const smoke = new THREE.Mesh(new THREE.SphereGeometry(3.8, 18, 14), new THREE.MeshStandardMaterial({ color: 0x87918f, transparent: true, opacity: 0.78, roughness: 1, depthWrite: false }));
            smoke.position.copy(mesh.position).setY(2.1);
            smoke.scale.set(0.1, 0.1, 0.1);
            scene.add(smoke);
            smokes.push({ mesh: smoke, life: 10 });
          }
          return false;
        }
        return true;
      };
      (mesh.userData as { update?: (dt: number) => boolean }).update = update;
    };

    const activeGrenades: THREE.Mesh[] = [];
    const originalThrowGrenade = throwGrenade;
    const trackedThrowGrenade = (kind: "frag" | "smoke") => {
      const before = new Set(scene.children);
      originalThrowGrenade(kind);
      const created = scene.children.find((child) => !before.has(child) && child instanceof THREE.Mesh && child.userData.update) as THREE.Mesh | undefined;
      if (created) activeGrenades.push(created);
    };

    const buy = (id: string) => {
      const weapon = WEAPONS[id];
      if (phase !== "buy" || !weapon || weapon.category !== "primary" || playerMoney < weapon.price) return false;
      playerMoney -= weapon.price;
      primaryId = id;
      ammo[id] = { clip: weapon.magazine, reserve: weapon.reserve };
      equip(id);
      return true;
    };

    const buyArmor = () => {
      if (phase !== "buy" || playerMoney < 650 || playerArmor >= 100) return false;
      playerMoney -= 650;
      playerArmor = 100;
      return true;
    };

    const pickBotTarget = (bot: Bot) => {
      const opponents = bots.filter((b) => b.alive && b.team !== bot.team);
      let target: { position: THREE.Vector3; bot?: Bot; player?: boolean } | null = null;
      let best = Infinity;
      for (const opponent of opponents) {
        const dist = bot.root.position.distanceTo(opponent.root.position);
        if (dist < best) { best = dist; target = { position: opponent.root.position, bot: opponent }; }
      }
      if (playerAlive && playerTeam !== bot.team) {
        const dist = bot.root.position.distanceTo(camera.position);
        if (dist < best) target = { position: camera.position, player: true };
      }
      return target;
    };

    const updateBots = (dt: number) => {
      if (phase !== "live") return;
      for (const bot of bots) {
        if (!bot.alive) continue;
        const legA = bot.root.userData.legA as THREE.Mesh;
        const legB = bot.root.userData.legB as THREE.Mesh;
        const armA = bot.root.userData.armA as THREE.Mesh;
        const armB = bot.root.userData.armB as THREE.Mesh;
        bot.fireCooldown -= dt;
        bot.decisionCooldown -= dt;
        const target = pickBotTarget(bot);
        const botEye = bot.root.position.clone().setY(1.5);
        const targetEye = target?.position.clone().setY(1.35);
        const targetVisible = target && targetEye && bot.root.position.distanceTo(target.position) < 24 && lineOfSight(botEye, targetEye);
        if (targetVisible && target) {
          const desiredYaw = Math.atan2(target.position.x - bot.root.position.x, target.position.z - bot.root.position.z);
          bot.root.rotation.y = THREE.MathUtils.lerp(bot.root.rotation.y, desiredYaw, dt * 6);
          legA.rotation.x = THREE.MathUtils.lerp(legA.rotation.x, 0, dt * 8);
          legB.rotation.x = THREE.MathUtils.lerp(legB.rotation.x, 0, dt * 8);
          armA.rotation.x = THREE.MathUtils.lerp(armA.rotation.x, -1.02, dt * 7);
          armB.rotation.x = THREE.MathUtils.lerp(armB.rotation.x, -1.16, dt * 7);
          if (bot.fireCooldown <= 0) {
            bot.fireCooldown = 0.18 + (1 - bot.skill) * 0.35 + Math.random() * 0.12;
            const distance = bot.root.position.distanceTo(target.position);
            const hitChance = clamp(bot.skill * (1 - distance / 70), 0.16, 0.82);
            if (Math.random() < hitChance) {
              if (target.player) damagePlayer(9 + Math.random() * 13, bot);
              else if (target.bot) damageBot(target.bot, 11 + Math.random() * 15, bot.name, "KSTRL", bot.team);
            }
          }
          continue;
        }

        if (bot.team === "attack") {
          if (bot.carryingBomb && !bombPlanted) {
            const zone = bot.destination.distanceTo(zoneA) < bot.destination.distanceTo(zoneB) ? zoneA : zoneB;
            bot.destination.copy(zone);
            if (bot.root.position.distanceTo(zone) < 2.8) {
              botPlantProgress += dt;
              if (botPlantProgress >= 3.2) {
                bombPlanted = true;
                bombSite = zone === zoneA ? "A" : "B";
                bombPosition.copy(zone);
                bombMesh.position.copy(zone).setY(0.16);
                bombMesh.visible = true;
                bot.carryingBomb = false;
                sound("plant");
              }
            }
          } else if (!bombPlanted) {
            bot.destination.copy(bot.id.endsWith("0") || bot.id.endsWith("2") || bot.id.endsWith("4") ? zoneA : zoneB);
          }
        } else if (bombPlanted) {
          bot.destination.copy(bombPosition);
          if (bot.root.position.distanceTo(bombPosition) < 2.2) {
            bot.defuseProgress += dt;
            if (bot.defuseProgress >= 7) endRound("defend", "CHARGE DEFUSED");
          }
        }

        const direction = bot.destination.clone().sub(bot.root.position).setY(0);
        if (direction.lengthSq() < 1) {
          bot.destination.set((Math.random() - 0.5) * 48, 0, (Math.random() - 0.5) * 48);
          continue;
        }
        direction.normalize();
        const speed = 2.4 + bot.skill * 1.4;
        const nextX = bot.root.position.x + direction.x * speed * dt;
        const nextZ = bot.root.position.z + direction.z * speed * dt;
        if (!collides(nextX, bot.root.position.z, 0.4)) bot.root.position.x = nextX;
        if (!collides(bot.root.position.x, nextZ, 0.4)) bot.root.position.z = nextZ;
        bot.root.rotation.y = Math.atan2(direction.x, direction.z);
        const stride = Math.sin(performance.now() * 0.008 + Number(bot.id.split("-")[1])) * 0.48;
        legA.rotation.x = stride;
        legB.rotation.x = -stride;
        armA.rotation.x = -0.82 - stride * 0.16;
        armB.rotation.x = -1.02 + stride * 0.12;
      }
    };

    const updateObjective = (dt: number) => {
      actionText = "";
      if (phase !== "live" || !playerAlive) return;
      const interacting = keys.has("KeyE") || touchKeys.has("interact");
      let canAct = false;
      if (playerTeam === "attack" && playerCarryingBomb && !bombPlanted) {
        const nearA = camera.position.distanceTo(zoneA) < 3.2;
        const nearB = camera.position.distanceTo(zoneB) < 3.2;
        if (nearA || nearB) {
          canAct = true;
          actionText = interacting ? "PLANTING CHARGE" : "HOLD E TO PLANT";
          if (interacting) {
            actionProgress += dt / 3.25;
            if (actionProgress >= 1) {
              bombPlanted = true;
              bombSite = nearA ? "A" : "B";
              bombPosition.copy(nearA ? zoneA : zoneB);
              bombMesh.position.copy(bombPosition).setY(0.16);
              bombMesh.visible = true;
              playerCarryingBomb = false;
              actionProgress = 0;
              sound("plant");
            }
          } else actionProgress = 0;
        }
      } else if (playerTeam === "defend" && bombPlanted && camera.position.distanceTo(bombPosition) < 2.7) {
        canAct = true;
        actionText = interacting ? "DEFUSING CHARGE" : "HOLD E TO DEFUSE";
        if (interacting) {
          actionProgress += dt / 5.2;
          if (actionProgress >= 1) endRound("defend", "CHARGE DEFUSED");
        } else actionProgress = 0;
      }
      if (!canAct) actionProgress = 0;
    };

    const updatePlayer = (dt: number) => {
      if (!screenActive) return;
      const targetFov = aiming ? (weaponId === "spectre" ? 34 : 62) : settingsRef.current.fov;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, dt * 8);
      camera.updateProjectionMatrix();
      if (!playerAlive || phase === "roundEnd" || phase === "matchEnd") return;
      const forwardInput = (keys.has("KeyW") || touchKeys.has("forward") ? 1 : 0) - (keys.has("KeyS") || touchKeys.has("back") ? 1 : 0);
      const sideInput = (keys.has("KeyD") || touchKeys.has("right") ? 1 : 0) - (keys.has("KeyA") || touchKeys.has("left") ? 1 : 0);
      const crouched = keys.has("ControlLeft") || touchKeys.has("crouch");
      const sprinting = (keys.has("ShiftLeft") || touchKeys.has("sprint")) && forwardInput > 0 && !crouched;
      const speed = sprinting ? 7.3 : crouched ? 2.8 : 5.2;
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const desired = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput));
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(speed);
      velocity.lerp(desired, 1 - Math.exp(-dt * 10));
      const nextX = camera.position.x + velocity.x * dt;
      const nextZ = camera.position.z + velocity.z * dt;
      if (!collides(nextX, camera.position.z)) camera.position.x = nextX;
      else velocity.x *= 0.18;
      if (!collides(camera.position.x, nextZ)) camera.position.z = nextZ;
      else velocity.z *= 0.18;
      const moving = velocity.length() > 0.6;
      if (moving) {
        bob += dt * (sprinting ? 13 : 9);
        stepTimer -= dt;
        if (stepTimer <= 0) { sound("step"); stepTimer = sprinting ? 0.32 : 0.45; }
      }
      jumpVelocity -= 10.8 * dt;
      jumpHeight += jumpVelocity * dt;
      if (jumpHeight < 0) { jumpHeight = 0; jumpVelocity = 0; }
      const height = crouched ? 1.18 : 1.68;
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, height + jumpHeight + (moving && jumpHeight === 0 ? Math.sin(bob) * 0.035 : 0), dt * 12);
      recoil = THREE.MathUtils.lerp(recoil, 0, dt * 9);
      gun.position.y = -0.34 + (moving ? Math.abs(Math.sin(bob)) * 0.018 : 0) + recoil * 0.45;
      gun.position.x = THREE.MathUtils.lerp(gun.position.x, aiming ? 0 : 0.34, dt * 10);
      gun.position.z = THREE.MathUtils.lerp(gun.position.z, (aiming ? -0.48 : -0.58) + recoil, dt * 12);
      gun.rotation.x = recoil * 1.4;
      camera.rotation.set(pitch, yaw, 0);
      if (firing) fireShot();
    };

    let snapshotAccumulator = 0;
    const publishSnapshot = () => {
      const current = currentWeapon();
      const mag = ammo[current.id] ?? { clip: 0, reserve: 0 };
      const objective = phase === "buy" ? "Buy phase · Prepare your loadout" : bombPlanted ? `${bombSite} site · Charge armed` : playerTeam === "attack" ? "Plant the charge at A or B" : "Defend both objective sites";
      const playerRows: PlayerRow[] = [
        { name: "YOU", team: playerTeam, kills: playerKills, deaths: playerDeaths, alive: playerAlive, isPlayer: true },
        ...bots.map((bot) => ({ name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, alive: bot.alive })),
      ];
      setSnapshot({
        phase, team: playerTeam, health: Math.round(playerHealth), armor: Math.round(playerArmor), money: Math.round(playerMoney),
        ammo: mag.clip, reserve: mag.reserve, weapon: current.label, weaponId: current.id, roundTime, phaseTime, attackScore, defendScore,
        round: roundNumber, alive: playerAlive, bombPlanted, bombTime, bombSite, actionText, actionProgress, objective, feed,
        dots: [
          { id: "you", x: camera.position.x, z: camera.position.z, team: playerTeam, alive: playerAlive },
          ...bots.map((bot) => ({ id: bot.id, x: bot.root.position.x, z: bot.root.position.z, team: bot.team, alive: bot.alive })),
        ],
        players: playerRows, roundMessage, hitMarker: performance.now() < hitMarkerUntil, kills: playerKills, deaths: playerDeaths,
        ping: 18 + Math.floor(Math.random() * 9),
      });
    };

    const updateRound = (dt: number) => {
      if (!screenActive) return;
      if (phase === "buy") {
        phaseTime -= dt;
        if (phaseTime <= 0) {
          phase = "live";
          roundTime = trainingMode ? 180 : 105;
          if (buyOpen) {
            buyOpen = false;
            setShowBuy(false);
            renderer.domElement.requestPointerLock?.();
          }
        }
      } else if (phase === "live") {
        if (bombPlanted) {
          bombTime -= dt;
          if (bombTime <= 0) endRound("attack", "TARGET DESTROYED");
          if (bombTime <= bombBeepAt) {
            sound("plant");
            bombBeepAt = bombTime - Math.max(0.18, bombTime / 38 * 0.9);
          }
          (bombLed.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(bombTime * 3) % 2 ? 0xff3b21 : 0x33130e);
        } else {
          roundTime -= dt;
          if (roundTime <= 0) endRound("defend", "TIME EXPIRED");
        }
        const attackersAlive = (playerTeam === "attack" && playerAlive ? 1 : 0) + bots.filter((b) => b.team === "attack" && b.alive).length;
        const defendersAlive = (playerTeam === "defend" && playerAlive ? 1 : 0) + bots.filter((b) => b.team === "defend" && b.alive).length;
        if (defendersAlive === 0) endRound("attack", "TEAM ELIMINATED");
        if (attackersAlive === 0 && !bombPlanted) endRound("defend", "TEAM ELIMINATED");
      } else if (phase === "roundEnd") {
        phaseTime -= dt;
        if (phaseTime <= 0 && !(!trainingMode && (attackScore >= 7 || defendScore >= 7))) {
          roundNumber += 1;
          beginRound();
        }
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement || !screenActive) return;
      const sensitivity = settingsRef.current.sensitivity * 0.0019;
      yaw -= event.movementX * sensitivity;
      pitch = clamp(pitch - event.movementY * sensitivity, -1.34, 1.34);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!screenActive) return;
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
        audio.resume();
        return;
      }
      if (event.button === 0) { firing = true; fireShot(); }
      if (event.button === 2) aiming = true;
    };
    const onMouseUp = (event: MouseEvent) => { if (event.button === 0) firing = false; if (event.button === 2) aiming = false; };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (event.code === "KeyR") reload();
      if (event.code === "Space" && jumpHeight <= 0.01 && playerAlive) jumpVelocity = 4.65;
      if (event.code === "Digit1") equip(primaryId ?? "v9");
      if (event.code === "Digit2") equip("v9");
      if (event.code === "Digit4") trackedThrowGrenade("frag");
      if (event.code === "Digit5") trackedThrowGrenade("smoke");
      if (event.code === "Tab") { event.preventDefault(); setShowScoreboard(true); }
      if (event.code === "KeyB" && phase === "buy") {
        buyOpen = !buyOpen;
        setShowBuy(buyOpen);
        if (buyOpen) {
          intentionalUnlock = true;
          document.exitPointerLock?.();
        } else renderer.domElement.requestPointerLock?.();
      }
      if (event.code === "Escape" && screenActive) setPaused(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === "Tab") setShowScoreboard(false);
      if (event.code === "KeyE") actionProgress = 0;
    };
    const onPointerLock = () => {
      if (intentionalUnlock) { intentionalUnlock = false; setPaused(false); return; }
      if (screenActive && document.pointerLockElement !== renderer.domElement && phase !== "matchEnd") setPaused(true);
      else setPaused(false);
    };
    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      renderer.setPixelRatio(settingsRef.current.quality === "performance" ? 1 : Math.min(window.devicePixelRatio, settingsRef.current.quality === "ultra" ? 2 : 1.55));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerlockchange", onPointerLock);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", onResize);

    engineRef.current = {
      start: (selectedDifficulty, training) => {
        screenActive = true;
        buyOpen = false;
        setShowBuy(false);
        trainingMode = training;
        attackScore = 0;
        defendScore = 0;
        roundNumber = 1;
        playerKills = 0;
        playerDeaths = 0;
        playerMoney = training ? 16000 : 3200;
        playerArmor = 0;
        primaryId = null;
        weaponId = "v9";
        ammo = { v9: { clip: 12, reserve: 48 } };
        bots.forEach((bot) => { bot.kills = 0; bot.deaths = 0; });
        setDifficulty(selectedDifficulty);
        beginRound();
        audio.resume();
        window.setTimeout(() => renderer.domElement.requestPointerLock?.(), 160);
      },
      resume: () => { audio.resume(); renderer.domElement.requestPointerLock?.(); },
      buy,
      buyArmor,
      setWeapon: (slot) => equip(slot === 1 ? (primaryId ?? "v9") : "v9"),
      throwGrenade: trackedThrowGrenade,
      setBuyMenu: (open) => {
        buyOpen = open;
        setShowBuy(open);
        if (open) {
          intentionalUnlock = true;
          document.exitPointerLock?.();
        } else renderer.domElement.requestPointerLock?.();
      },
      setTouch: (key, down) => {
        if (down) touchKeys.add(key); else touchKeys.delete(key);
        if (!down && key === "interact") actionProgress = 0;
      },
      setFire: (down) => { firing = down; if (down) fireShot(); },
      touchLook: (dx, dy) => {
        yaw -= dx * settingsRef.current.sensitivity * 0.0042;
        pitch = clamp(pitch - dy * settingsRef.current.sensitivity * 0.0042, -1.34, 1.34);
      },
    };

    buildGun(WEAPONS.v9);
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      updateRound(dt);
      updatePlayer(dt);
      updateBots(dt);
      updateObjective(dt);
      for (let i = activeGrenades.length - 1; i >= 0; i--) {
        const grenade = activeGrenades[i];
        const alive = (grenade.userData as { update: (delta: number) => boolean }).update(dt);
        if (!alive) activeGrenades.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.life -= dt;
        particle.velocity.y -= 5 * dt;
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        if (particle.life <= 0) { scene.remove(particle.mesh); particles.splice(i, 1); }
      }
      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        smoke.life -= dt;
        const scale = Math.min(1, (10 - smoke.life) / 1.2);
        smoke.mesh.scale.setScalar(scale);
        if (smoke.life < 1.5) (smoke.mesh.material as THREE.MeshStandardMaterial).opacity = smoke.life / 1.5 * 0.78;
        if (smoke.life <= 0) { scene.remove(smoke.mesh); smokes.splice(i, 1); }
      }
      snapshotAccumulator += dt;
      if (snapshotAccumulator > 0.08) { snapshotAccumulator = 0; publishSnapshot(); }
      mount.style.setProperty("--damage-flash", performance.now() < damageFlashUntil ? "0.52" : "0");
      dust.rotation.y += dt * 0.0025;
      dust.position.x = Math.sin(performance.now() * 0.00008) * 0.8;
      bloomPass.strength = settingsRef.current.quality === "performance" ? 0.06 : settingsRef.current.quality === "ultra" ? 0.27 : 0.18;
      renderer.shadowMap.enabled = settingsRef.current.quality !== "performance";
      composer.render(dt);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerlockchange", onPointerLock);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("resize", onResize);
      composer.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose()); else material.dispose();
        }
      });
      audio.close();
      mount.removeChild(renderer.domElement);
      engineRef.current = null;
    };
  }, []);

  const startGame = useCallback((training = false) => {
    setScreen("game");
    setPaused(false);
    setShowBuy(false);
    setShowSettings(false);
    window.setTimeout(() => engineRef.current?.start(training ? "recruit" : difficulty, training), 0);
  }, [difficulty]);

  const buyItem = (id: string) => {
    const ok = id === "armor" ? engineRef.current?.buyArmor() : engineRef.current?.buy(id);
    setToast(ok ? `${id === "armor" ? "Armor" : WEAPONS[id].label} equipped` : "Unavailable or insufficient funds");
    window.setTimeout(() => setToast(""), 1500);
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  const teamLabel = snapshot.team === "attack" ? "STRIKERS" : "WARDENS";
  const scoreLeft = snapshot.team === "attack" ? snapshot.attackScore : snapshot.defendScore;
  const scoreRight = snapshot.team === "attack" ? snapshot.defendScore : snapshot.attackScore;
  const aliveAttack = snapshot.players.filter((p) => p.team === "attack" && p.alive).length;
  const aliveDefend = snapshot.players.filter((p) => p.team === "defend" && p.alive).length;

  const scoreboardGroups = useMemo(() => ({
    attack: snapshot.players.filter((player) => player.team === "attack").sort((a, b) => b.kills - a.kills),
    defend: snapshot.players.filter((player) => player.team === "defend").sort((a, b) => b.kills - a.kills),
  }), [snapshot.players]);

  const touch = (key: string, down: boolean) => engineRef.current?.setTouch(key, down);

  return (
    <main className={`breachline ${screen === "game" ? "is-playing" : "is-menu"}`}>
      <div ref={mountRef} className="viewport" onTouchStart={(event) => {
        if (event.touches.length && event.touches[0].clientX > window.innerWidth * 0.42) lookTouchRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }} onTouchMove={(event) => {
        const last = lookTouchRef.current;
        const point = event.touches[0];
        if (!last || !point) return;
        engineRef.current?.touchLook(point.clientX - last.x, point.clientY - last.y);
        lookTouchRef.current = { x: point.clientX, y: point.clientY };
      }} onTouchEnd={() => { lookTouchRef.current = null; }} />

      {screen === "menu" && (
        <section className="main-menu" aria-label="Breachline main menu">
          <div className="menu-art" style={{ backgroundImage: "url('./menu-hero.png')" }} />
          <div className="menu-shade" />
          <header className="menu-topbar">
            <div className="brand-lockup"><span className="brand-mark">B</span><span>BREACHLINE</span><small>v1.0 · WEB OPS</small></div>
            <div className="career-strip"><span>CAREER</span><strong>{stats.wins}W</strong><span>{stats.matches} MATCHES</span><span>{stats.eliminations} ELIMS</span></div>
          </header>
          <div className="menu-content">
            <div className="eyebrow"><span className="live-dot" /> OPERATION 01 · FOUNDRY</div>
            <h1>BREACH<span>LINE</span></h1>
            <p className="menu-subtitle">DEMOLITION PROTOCOL</p>
            <p className="menu-copy">Two teams. Two targets. One life per round. Break the line or hold it.</p>
            <div className="difficulty" role="group" aria-label="Bot difficulty">
              {(["recruit", "veteran", "elite"] as Difficulty[]).map((value) => (
                <button key={value} className={difficulty === value ? "active" : ""} onClick={() => setDifficulty(value)}>{value}</button>
              ))}
            </div>
            <div className="menu-actions">
              <button className="primary-action" onClick={() => startGame(false)}><span>DEPLOY</span><small>5V5 DEMOLITION · FOUNDRY</small></button>
              <button className="secondary-action" onClick={() => startGame(true)}><span>TRAINING RANGE</span><small>Unlimited economy · 4 targets</small></button>
            </div>
            <div className="feature-line"><span>9 AI OPERATIVES</span><i /><span>5 WEAPONS</span><i /><span>2 OBJECTIVE SITES</span><i /><span>LOCAL CAREER</span></div>
          </div>
          <footer className="menu-footer"><span>Original browser tactical FPS · Best with headphones</span><button onClick={() => setShowSettings(true)}>SETTINGS</button></footer>
        </section>
      )}

      {screen === "game" && (
        <section className="game-ui" aria-label="Game HUD">
          <div className="damage-flash" />
          <div className="vignette" />
          <header className="match-header">
            <div className={`team-panel ${snapshot.team === "attack" ? "friendly attack" : "friendly defend"}`}><small>{teamLabel}</small><strong>{scoreLeft}</strong><span>{snapshot.team === "attack" ? aliveAttack : aliveDefend} ALIVE</span></div>
            <div className="round-clock">
              <span>ROUND {snapshot.round} · FIRST TO 7</span>
              <strong className={snapshot.bombPlanted ? "danger" : ""}>{snapshot.phase === "buy" ? `BUY ${Math.ceil(snapshot.phaseTime)}` : snapshot.bombPlanted ? formatClock(snapshot.bombTime) : formatClock(snapshot.roundTime)}</strong>
              <small>{snapshot.bombPlanted ? `CHARGE ARMED · SITE ${snapshot.bombSite}` : snapshot.phase === "buy" ? "PREPARE" : "LIVE"}</small>
            </div>
            <div className={`team-panel ${snapshot.team === "attack" ? "enemy defend" : "enemy attack"}`}><strong>{scoreRight}</strong><small>{snapshot.team === "attack" ? "WARDENS" : "STRIKERS"}</small><span>{snapshot.team === "attack" ? aliveDefend : aliveAttack} ALIVE</span></div>
          </header>

          <aside className="minimap" aria-label="Tactical minimap">
            <div className="map-grid" />
            <span className="site site-a">A</span><span className="site site-b">B</span>
            {snapshot.dots.filter((dot) => dot.alive && (dot.team === snapshot.team || dot.id === "you")).map((dot) => (
              <i key={dot.id} className={`map-dot ${dot.id === "you" ? "you" : dot.team}`} style={{ left: `${((dot.x + 36) / 72) * 100}%`, top: `${((dot.z + 36) / 72) * 100}%` }} />
            ))}
            <label>FOUNDRY</label>
          </aside>

          <div className="objective-chip"><span className={snapshot.bombPlanted ? "pulse" : ""}>{snapshot.bombPlanted ? "◆" : "◇"}</span><div><small>OBJECTIVE</small><strong>{snapshot.objective}</strong></div></div>

          <div className="killfeed">{snapshot.feed.map((item) => <div key={item.id}><span>{item.killer}</span><b>{item.weapon}</b><span className={item.friendly ? "friendly-fire" : ""}>{item.victim}</span></div>)}</div>

          <div className={`crosshair ${snapshot.hitMarker ? "hit" : ""}`}><i /><i /><i /><i /><b /></div>

          {snapshot.actionText && <div className="action-progress"><strong>{snapshot.actionText}</strong><div><i style={{ width: `${snapshot.actionProgress * 100}%` }} /></div></div>}
          {snapshot.roundMessage && <div className="round-banner"><small>ROUND COMPLETE</small><strong>{snapshot.roundMessage}</strong></div>}
          {!snapshot.alive && snapshot.phase !== "matchEnd" && <div className="eliminated"><span>ELIMINATED</span><strong>Round continues · Observe the outcome</strong></div>}

          <div className="hud-bottom">
            <div className="vitals"><div><small>HEALTH</small><strong>{snapshot.health}</strong><i style={{ width: `${snapshot.health}%` }} /></div><div><small>ARMOR</small><strong>{snapshot.armor}</strong><i style={{ width: `${snapshot.armor}%` }} /></div></div>
            <div className="status-center"><span className={snapshot.team}>{teamLabel}</span><strong>${snapshot.money.toLocaleString()}</strong><small>{snapshot.kills} K · {snapshot.deaths} D · {snapshot.ping} MS</small></div>
            <div className="ammo"><small>{snapshot.weapon}</small><div><strong>{snapshot.ammo}</strong><span>/ {snapshot.reserve}</span></div><label>1 PRIMARY · 2 SIDEARM · 4 FRAG · 5 SMOKE</label></div>
          </div>

          <button className="hud-menu-button" aria-label="Pause" onClick={() => { setPaused(true); document.exitPointerLock?.(); }}>Ⅱ</button>
          {snapshot.phase === "buy" && <button className="buy-hint" onClick={() => engineRef.current?.setBuyMenu(true)}><kbd>B</kbd> OPEN BUY MENU</button>}
          {toast && <div className="toast">{toast}</div>}

          <div className="mobile-controls" aria-label="Touch controls">
            <div className="mobile-dpad">
              <button onPointerDown={() => touch("forward", true)} onPointerUp={() => touch("forward", false)} onPointerCancel={() => touch("forward", false)}>▲</button>
              <button onPointerDown={() => touch("left", true)} onPointerUp={() => touch("left", false)} onPointerCancel={() => touch("left", false)}>◀</button>
              <button onPointerDown={() => touch("back", true)} onPointerUp={() => touch("back", false)} onPointerCancel={() => touch("back", false)}>▼</button>
              <button onPointerDown={() => touch("right", true)} onPointerUp={() => touch("right", false)} onPointerCancel={() => touch("right", false)}>▶</button>
            </div>
            <div className="mobile-actions"><button className="mobile-fire" onPointerDown={() => engineRef.current?.setFire(true)} onPointerUp={() => engineRef.current?.setFire(false)} onPointerCancel={() => engineRef.current?.setFire(false)}>FIRE</button><button onPointerDown={() => touch("interact", true)} onPointerUp={() => touch("interact", false)}>USE</button><button onClick={() => engineRef.current?.setWeapon(2)}>SWAP</button></div>
          </div>
        </section>
      )}

      {(showBuy && screen === "game") && (
        <div className="modal-layer buy-layer" role="dialog" aria-modal="true" aria-label="Buy menu">
          <div className="buy-menu">
            <header><div><small>FIELD QUARTERMASTER</small><h2>SELECT LOADOUT</h2></div><strong>${snapshot.money.toLocaleString()}</strong><button onClick={() => engineRef.current?.setBuyMenu(false)}>CLOSE ×</button></header>
            <div className="buy-grid">
              {Object.values(WEAPONS).filter((weapon) => weapon.category === "primary").map((weapon) => (
                <button key={weapon.id} onClick={() => buyItem(weapon.id)} disabled={snapshot.money < weapon.price} className={snapshot.weaponId === weapon.id ? "owned" : ""}>
                  <span className="weapon-silhouette" style={{ width: `${55 + weapon.length * 58}px` }} />
                  <small>{weapon.short}</small><strong>{weapon.label}</strong><em>${weapon.price.toLocaleString()}</em>
                  <div><span>DMG {weapon.damage}</span><span>CAP {weapon.magazine}</span><span>{weapon.auto ? "AUTO" : "SEMI"}</span></div>
                </button>
              ))}
              <button onClick={() => buyItem("armor")} disabled={snapshot.money < 650 || snapshot.armor >= 100} className="armor-card"><span className="armor-icon">⬟</span><small>DEFENSE</small><strong>Composite Armor</strong><em>$650</em><div><span>100 ARMOR</span><span>KEVLAR</span></div></button>
            </div>
            <footer>Purchases are locked when the round goes live · Press B to close</footer>
          </div>
        </div>
      )}

      {showScoreboard && screen === "game" && (
        <div className="modal-layer scoreboard-layer">
          <div className="scoreboard">
            <header><div><small>DEMOLITION · FOUNDRY</small><h2>{snapshot.attackScore} <span>—</span> {snapshot.defendScore}</h2></div><strong>ROUND {snapshot.round}</strong></header>
            {(["attack", "defend"] as Team[]).map((team) => <section key={team}><h3>{team === "attack" ? "STRIKERS" : "WARDENS"}</h3>{scoreboardGroups[team].map((player) => <div key={`${team}-${player.name}`} className={`${player.isPlayer ? "is-player" : ""} ${!player.alive ? "is-dead" : ""}`}><span className="status-dot" /><strong>{player.name}</strong><span>{player.kills} K</span><span>{player.deaths} D</span><span>{player.alive ? "ACTIVE" : "DOWN"}</span></div>)}</section>)}
          </div>
        </div>
      )}

      {paused && screen === "game" && snapshot.phase !== "matchEnd" && (
        <div className="modal-layer pause-layer" role="dialog" aria-modal="true" aria-label="Pause menu">
          <div className="pause-menu"><small>OPERATION PAUSED</small><h2>BREACHLINE</h2><button className="primary" onClick={() => { setPaused(false); engineRef.current?.resume(); }}>RESUME OPERATION</button><button onClick={() => setShowSettings(true)}>SETTINGS</button><button onClick={toggleFullscreen}>TOGGLE FULLSCREEN</button><button onClick={() => { setScreen("menu"); setPaused(false); }}>LEAVE MATCH</button><p>WASD move · Mouse aim · LMB fire · R reload<br />Shift sprint · Ctrl crouch · E interact · Tab scores</p></div>
        </div>
      )}

      {snapshot.phase === "matchEnd" && screen === "game" && (
        <div className="modal-layer result-layer"><div className="result-card"><small>OPERATION COMPLETE</small><h2>{snapshot.roundMessage}</h2><div><span><b>{snapshot.kills}</b> ELIMINATIONS</span><span><b>{snapshot.deaths}</b> DEATHS</span><span><b>{snapshot.attackScore}—{snapshot.defendScore}</b> FINAL</span></div><button onClick={() => startGame(false)}>PLAY AGAIN</button><button onClick={() => setScreen("menu")}>MAIN MENU</button></div></div>
      )}

      {showSettings && (
        <div className="modal-layer settings-layer" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="settings-card"><header><div><small>SYSTEM</small><h2>SETTINGS</h2></div><button onClick={() => setShowSettings(false)}>DONE ×</button></header>
            <label><span>LOOK SENSITIVITY <b>{settings.sensitivity.toFixed(2)}</b></span><input type="range" min="0.2" max="1.8" step="0.05" value={settings.sensitivity} onChange={(event) => setSettings({ ...settings, sensitivity: Number(event.target.value) })} /></label>
            <label><span>FIELD OF VIEW <b>{settings.fov}°</b></span><input type="range" min="62" max="100" value={settings.fov} onChange={(event) => setSettings({ ...settings, fov: Number(event.target.value) })} /></label>
            <label><span>MASTER VOLUME <b>{Math.round(settings.volume * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => setSettings({ ...settings, volume: Number(event.target.value) })} /></label>
            <div className="quality"><span>RENDER QUALITY</span><div>{(["performance", "balanced", "ultra"] as const).map((quality) => <button key={quality} className={settings.quality === quality ? "active" : ""} onClick={() => setSettings({ ...settings, quality })}>{quality}</button>)}</div></div>
          </div>
        </div>
      )}
    </main>
  );
}
