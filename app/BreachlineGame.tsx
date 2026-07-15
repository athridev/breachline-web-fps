"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

type Team = "attack" | "defend";
type Phase = "briefing" | "buy" | "live" | "roundEnd" | "matchEnd";
type Difficulty = "recruit" | "veteran" | "elite";
type GameMode = "demolition" | "training" | "ffa";

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
  gameMode: GameMode;
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
  spawnProtected: boolean;
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
  category: "primary" | "sidearm" | "melee";
};

const WEAPONS: Record<string, Weapon> = {
  v9: { id: "v9", label: "9mm Service Pistol", short: "9MM", price: 0, damage: 31, fireRate: 0.21, magazine: 12, reserve: 48, reload: 1.35, spread: 0.012, auto: false, color: 0x252a2c, length: 0.46, category: "sidearm" },
  akm: { id: "akm", label: "AKM Rifle", short: "AKM", price: 2700, damage: 38, fireRate: 0.1, magazine: 30, reserve: 90, reload: 2.35, spread: 0.016, auto: true, color: 0x292b2a, length: 0.9, category: "primary" },
  karambit: { id: "karambit", label: "Karambit Knife", short: "KNIFE", price: 0, damage: 58, fireRate: 0.48, magazine: 1, reserve: 0, reload: 0, spread: 0, auto: false, color: 0x111719, length: 0.48, category: "melee" },
};

const BOT_NAMES = ["KITE", "NOVA", "MERC", "ZERO", "RUNE", "HELIOS", "VIPER", "ROOK", "MICA", "SOL", "EMBER", "ATLAS", "SHADE", "ECHO", "ORBIT", "ONYX", "FROST", "KNOX", "BLADE", "SABLE"];

const initialSnapshot: Snapshot = {
  gameMode: "demolition",
  phase: "briefing",
  team: "attack",
  health: 100,
  armor: 0,
  money: 3200,
  ammo: 12,
  reserve: 48,
  weapon: "9mm Service Pistol",
  weaponId: "v9",
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
  spawnProtected: false,
};

type EngineApi = {
  start: (difficulty: Difficulty, mode: GameMode) => void;
  pause: (paused: boolean) => void;
  resume: () => void;
  stop: () => void;
  buy: (id: string) => boolean;
  buyArmor: () => boolean;
  setWeapon: (slot: 1 | 2 | 3) => void;
  cycleWeapon: () => void;
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
  deathTime: number;
  deathStart: THREE.Vector3;
  deathStartQuaternion: THREE.Quaternion;
  deathTargetQuaternion: THREE.Quaternion;
  deathDrift: THREE.Vector3;
  respawnAt: number;
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.84;
    renderer.domElement.className = "game-canvas";
    renderer.domElement.setAttribute("aria-label", "Breachline first-person game view");
    mount.appendChild(renderer.domElement);
    const lockPointer = () => {
      try {
        const pending = renderer.domElement.requestPointerLock?.();
        if (pending instanceof Promise) void pending.catch(() => undefined);
      } catch { /* Pointer lock is optional in embedded browsers. */ }
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8eb5cf);
    scene.fog = new THREE.FogExp2(0xd2c09d, 0.0046);

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
          topColor: { value: new THREE.Color(0x4f90bc) },
          horizonColor: { value: new THREE.Color(0xf2d6a5) },
          bottomColor: { value: new THREE.Color(0xc39a67) },
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

    let environmentMap: THREE.DataTexture | null = null;
    const environmentUrl = new URL("./hdr/industrial-sunset-1k.hdr", window.location.href).href;
    new HDRLoader().load(environmentUrl, (texture) => {
      environmentMap = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      scene.environmentIntensity = 0.72;
      scene.environmentRotation.set(0, Math.PI * 0.18, 0);
    });

    const hemi = new THREE.HemisphereLight(0xd9efff, 0x4b4034, 0.88);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd6a0, 2.18);
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

    const fill = new THREE.DirectionalLight(0x78a7bd, 0.48);
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
    const groundTexture = tiledTexture("polyhaven/red_sandstone_pavement_diff_1k.jpg", 14, 14);
    const groundNormal = tiledTexture("polyhaven/red_sandstone_pavement_nor_gl_1k.jpg", 14, 14, false);
    const groundRough = tiledTexture("polyhaven/red_sandstone_pavement_rough_1k.jpg", 14, 14, false);
    const concreteTexture = tiledTexture("polyhaven/old_sandstone_02_diff_1k.jpg", 2.3, 2.3);
    const concreteNormal = tiledTexture("polyhaven/old_sandstone_02_nor_gl_1k.jpg", 2.3, 2.3, false);
    const concreteRough = tiledTexture("polyhaven/old_sandstone_02_rough_1k.jpg", 2.3, 2.3, false);
    const metalTexture = tiledTexture("metal-v2.avif", 1.5, 1.25);
    const metalBump = tiledTexture("metal-v2.avif", 1.5, 1.25, false);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9b08b, map: groundTexture, normalMap: groundNormal, roughnessMap: groundRough, roughness: 0.96, metalness: 0.01 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(84, 84, 20, 20), floorMat);
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
        roughness: isMetal ? 0.48 : 0.86,
        metalness: isMetal ? 0.68 : 0.05,
        ...(isMetal
          ? { map: metalTexture, bumpMap: metalBump, bumpScale: 0.09 }
          : { map: concreteTexture, normalMap: concreteNormal, roughnessMap: concreteRough }),
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

    // Original three-lane desert arena: long lane, central doors, tunnels, and two courtyard sites.
    addBox(0, -41, 84, 2, 7, 0x9d794e);
    addBox(0, 41, 84, 2, 7, 0x9d794e);
    addBox(-41, 0, 2, 84, 7, 0x9d794e);
    addBox(41, 0, 2, 84, 7, 0x9d794e);
    addBox(-29, 24, 18, 6, 5.8, 0xa98258);
    addBox(-28, 10, 11, 4, 4.8, 0xb08c62);
    addBox(-31, -5, 12, 5, 5.5, 0x9f7a51);
    addBox(-31, -31, 18, 7, 6.5, 0x9a7248);
    addBox(29, 24, 18, 6, 5.8, 0xa98258);
    addBox(29, 10, 11, 4, 4.8, 0xb08c62);
    addBox(31, -5, 12, 5, 5.5, 0x9f7a51);
    addBox(31, -31, 18, 7, 6.5, 0x9a7248);
    addBox(-9, 19, 5, 18, 5.5, 0xaa845a);
    addBox(9, 17, 5, 14, 5.5, 0xaa845a);
    addBox(-9, -8, 5, 13, 5.5, 0xa37b50);
    addBox(9, -11, 5, 18, 5.5, 0xa37b50);
    addBox(-5.2, -28, 3, 4, 4.5, 0x967149);
    addBox(5.2, -28, 3, 4, 4.5, 0x967149);
    addBox(-22, -18, 8, 3, 3.4, 0xaa845a);
    addBox(22, -18, 8, 3, 3.4, 0xaa845a);
    addBox(-18, 31, 9, 3, 3.2, 0x9f7b55);
    addBox(18, 31, 9, 3, 3.2, 0x9f7b55);
    addBox(-27, -23, 3.2, 3.2, 2.1, 0x795333, 0.55);
    addBox(-22.8, -26, 3.2, 3.2, 2.1, 0x795333, 0.55);
    addBox(27, -23, 3.2, 3.2, 2.1, 0x795333, 0.55);
    addBox(22.8, -26, 3.2, 3.2, 2.1, 0x795333, 0.55);

    const sandstoneDetail = new THREE.MeshStandardMaterial({ color: 0xc6a77c, map: concreteTexture, normalMap: concreteNormal, roughnessMap: concreteRough, roughness: 0.92 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x3b281b, roughness: 0.72, metalness: 0.04 });
    const addArchway = (x: number, z: number, rotation = 0, width = 4.2) => {
      const arch = new THREE.Group();
      const pillarGeometry = new RoundedBoxGeometry(0.58, 3.5, 0.78, 2, 0.08);
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeometry, sandstoneDetail);
        pillar.position.set(side * width * 0.48, 1.75, 0);
        pillar.castShadow = pillar.receiveShadow = true;
        arch.add(pillar);
      }
      const lintel = new THREE.Mesh(new RoundedBoxGeometry(width + 0.65, 0.62, 0.86, 3, 0.12), sandstoneDetail);
      lintel.position.y = 3.28;
      lintel.castShadow = lintel.receiveShadow = true;
      arch.add(lintel);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(width * 0.31, 0.16, 8, 28, Math.PI), sandstoneDetail);
      trim.position.set(0, 2.72, -0.44);
      trim.rotation.z = 0;
      arch.add(trim);
      arch.position.set(x, 0, z);
      arch.rotation.y = rotation;
      arch.traverse((child) => { if (child instanceof THREE.Mesh) obstacleMeshes.push(child); });
      scene.add(arch);
    };
    addArchway(0, -28, 0, 6.2);
    addArchway(-18, 3, Math.PI / 2, 3.7);
    addArchway(18, 3, Math.PI / 2, 3.7);
    addArchway(0, 8, 0, 4.4);

    const addDoubleDoor = (x: number, z: number, rotation: number) => {
      const doors = new THREE.Group();
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(new RoundedBoxGeometry(1.35, 3.1, 0.18, 2, 0.035), darkWood);
        door.position.set(side * 1.48, 1.55, 0);
        door.rotation.y = side * 0.3;
        door.castShadow = true;
        doors.add(door);
        for (const y of [0.65, 1.55, 2.45]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.09, 0.08), new THREE.MeshStandardMaterial({ color: 0x1f2020, metalness: 0.78, roughness: 0.38 }));
          brace.position.set(side * 1.48, y, -0.13);
          doors.add(brace);
        }
      }
      doors.position.set(x, 0, z);
      doors.rotation.y = rotation;
      scene.add(doors);
    };
    addDoubleDoor(0, -27.35, 0);
    addDoubleDoor(0, 8.1, 0);

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

    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xa8875c, map: concreteTexture, normalMap: concreteNormal, roughnessMap: concreteRough, roughness: 0.9, metalness: 0.02 });
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

    const zoneA = new THREE.Vector3(-27, 0, -24);
    const zoneB = new THREE.Vector3(27, 0, -24);
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
    gun.position.set(0.33, -0.31, -0.56);
    camera.add(gun);
    scene.add(camera);
    let weaponId = "v9";
    const weaponModels = new Map<string, THREE.Group>();
    const bots: Bot[] = [];
    const muzzle = new THREE.PointLight(0xffa45d, 0, 4.5, 2);
    const muzzleFlash = new THREE.Group();
    const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
    const flashCone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 7, 1, true), flashMaterial);
    flashCone.rotation.x = -Math.PI / 2;
    flashCone.position.z = -0.12;
    const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0b8, blending: THREE.AdditiveBlending, depthWrite: false }));
    muzzleFlash.add(flashCone, flashCore);
    muzzleFlash.visible = false;
    gun.add(muzzle, muzzleFlash);
    let gunMeshes: THREE.Object3D[] = [];
    const buildGun = (weapon: Weapon) => {
      for (const child of gunMeshes) gun.remove(child);
      gunMeshes = [];
      const metal = new THREE.MeshPhysicalMaterial({ color: weapon.color, roughness: 0.27, metalness: 0.88, clearcoat: 0.12, clearcoatRoughness: 0.35 });
      const polymer = new THREE.MeshStandardMaterial({ color: 0x171d1f, roughness: 0.62, metalness: 0.18 });
      const rubber = new THREE.MeshStandardMaterial({ color: 0x101415, roughness: 0.9, metalness: 0.02 });
      const accent = new THREE.MeshStandardMaterial({ color: 0xd45b22, roughness: 0.46, metalness: 0.52 });
      const addPart = (mesh: THREE.Mesh) => { mesh.castShadow = true; gun.add(mesh); gunMeshes.push(mesh); return mesh; };
      const addObject = (object: THREE.Object3D) => { gun.add(object); gunMeshes.push(object); return object; };
      const model = weaponModels.get(weapon.id)?.clone(true);
      const usesDetailedModel = Boolean(model?.userData.detailedViewmodel);

      if (weapon.id === "karambit") {
        if (model) {
          model.scale.setScalar(0.036);
          model.position.set(0.015, 0.085, 0);
          model.rotation.set(-0.08, 0.18, -0.15);
          addObject(model);
          muzzle.visible = false;
          muzzleFlash.visible = false;
          return;
        }
        const knife = new THREE.Group();
        const bladeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x9ca9ad, roughness: 0.16, metalness: 0.96, clearcoat: 0.28, clearcoatRoughness: 0.18, envMapIntensity: 1.65 });
        const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x101718, roughness: 0.48, metalness: 0.34 });
        const bladeShape = new THREE.Shape();
        bladeShape.moveTo(0.11, 0.07);
        bladeShape.bezierCurveTo(-0.07, 0.09, -0.29, 0.22, -0.35, 0.37);
        bladeShape.bezierCurveTo(-0.24, 0.3, -0.06, 0.205, 0.1, 0.18);
        bladeShape.quadraticCurveTo(0.14, 0.13, 0.11, 0.07);
        const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.036, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.012, bevelThickness: 0.01, curveSegments: 18 });
        const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        knife.add(blade);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(bladeGeometry, 24), new THREE.LineBasicMaterial({ color: 0xe7f0ef, transparent: true, opacity: 0.72 }));
        knife.add(edge);
        const handle = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.38, 0.085, 4, 0.026), gripMaterial);
        handle.position.set(0.12, -0.105, 0.028);
        handle.rotation.z = -0.12;
        knife.add(handle);
        for (const offset of [-0.12, -0.035, 0.05]) {
          const groove = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.022, 0.095, 2, 0.008), accent);
          groove.position.set(0.12, offset, 0.028);
          groove.rotation.z = -0.12;
          knife.add(groove);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.02, 10, 30), bladeMaterial);
        ring.position.set(0.145, -0.345, 0.028);
        knife.add(ring);
        const pommel = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.07, 0.09, 3, 0.018), bladeMaterial);
        pommel.position.set(0.138, -0.275, 0.028);
        pommel.rotation.z = -0.12;
        knife.add(pommel);
        knife.scale.setScalar(0.48);
        knife.rotation.set(-0.08, -0.28, -0.32);
        knife.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true; });
        addObject(knife);
      } else if (model) {
        model.rotation.y = usesDetailedModel ? Number(model.userData.viewRotationY ?? 0) : Math.PI / 2;
        model.rotation.z = weapon.id === "akm" && !usesDetailedModel ? -0.018 : 0;
        model.scale.setScalar(usesDetailedModel ? Number(model.userData.viewScale ?? 0.1) : weapon.id === "akm" ? 0.29 : 0.45);
        model.position.set(0, weapon.id === "akm" ? 0.01 : -0.025, usesDetailedModel ? Number(model.userData.viewPositionZ ?? -0.04) : weapon.id === "akm" ? -0.11 : -0.035);
        addObject(model);
      } else {
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
      }

      const muzzleZ = usesDetailedModel ? Number(model?.userData.viewMuzzleZ ?? -0.54) : -weapon.length * 1.48;
      muzzle.position.set(0, 0.025, muzzleZ);
      muzzleFlash.position.set(0, 0.025, muzzleZ);
      muzzle.visible = weapon.category !== "melee";
      muzzleFlash.visible = false;
    };

    const modelBase = new URL("./models/quaternius/", window.location.href).href;
    const upgradeWeaponMaterials = (object: THREE.Group) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const upgraded = sourceMaterials.map((source) => {
          const name = source.name.toLowerCase();
          const isWood = name.includes("wood");
          const isDarkWood = name.includes("darkwood");
          const isMetal = name.includes("metal");
          const isBlack = name.includes("black");
          const color = new THREE.Color(isWood ? (isDarkWood ? 0x321b13 : 0x542a18) : isMetal ? (name.includes("dark") ? 0x1b1e1f : 0x343738) : isBlack ? 0x0d1011 : 0x242627);
          return new THREE.MeshPhysicalMaterial({
            name: source.name,
            color,
            roughness: isWood ? 0.42 : isMetal ? 0.24 : 0.62,
            metalness: isWood ? 0.02 : isMetal ? 0.92 : isBlack ? 0.28 : 0.18,
            clearcoat: isWood ? 0.34 : 0.12,
            clearcoatRoughness: isWood ? 0.32 : 0.46,
            envMapIntensity: isMetal ? 1.35 : 0.86,
          });
        });
        child.material = Array.isArray(child.material) ? upgraded : upgraded[0];
        child.castShadow = true;
        child.receiveShadow = true;
      });
      return object;
    };
    const refreshBotWeaponModel = (root: THREE.Group) => {
      const mount = root.userData.weaponMount as THREE.Group | undefined;
      const source = weaponModels.get("akmBot") ?? weaponModels.get("akm");
      if (!mount || !source) return;
      mount.clear();
      const model = source.clone(true);
      model.rotation.y = Math.PI / 2;
      model.scale.setScalar(0.255);
      model.position.set(0.08, 1.19, -0.5);
      model.traverse((child) => {
        child.userData.botId = root.userData.botId;
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      mount.add(model);
    };
    const loadWeaponModel = (id: "akmBot" | "v9", filename: string) => {
      const materialLoader = new MTLLoader();
      materialLoader.setPath(modelBase);
      materialLoader.load(`${filename}.mtl`, (materials) => {
        materials.preload();
        const objectLoader = new OBJLoader();
        objectLoader.setMaterials(materials);
        objectLoader.setPath(modelBase);
        objectLoader.load(`${filename}.obj`, (object) => {
          const existing = weaponModels.get(id);
          if (!existing?.userData.detailedViewmodel) weaponModels.set(id, upgradeWeaponMaterials(object));
          if (id === "akmBot") bots.forEach((bot) => refreshBotWeaponModel(bot.root));
          if (weaponId === id && !existing?.userData.detailedViewmodel) buildGun(WEAPONS[id]);
        });
      });
    };
    loadWeaponModel("akmBot", "AssaultRifle_2");
    loadWeaponModel("v9", "Pistol_1");
    const detailedAkUrl = new URL("./models/lamoot/highpoly_ak47.obj", window.location.href).href;
    new OBJLoader().load(detailedAkUrl, (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const wrapper = new THREE.Group();
      wrapper.userData.detailedViewmodel = true;
      wrapper.userData.viewScale = 0.108;
      wrapper.userData.viewRotationY = 0;
      wrapper.userData.viewPositionZ = -0.04;
      wrapper.userData.viewMuzzleZ = -0.54;
      wrapper.add(object);
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.material = new THREE.MeshPhysicalMaterial({
          color: 0x1c2021,
          roughness: 0.24,
          metalness: 0.9,
          clearcoat: 0.14,
          clearcoatRoughness: 0.38,
          envMapIntensity: 1.4,
        });
        child.castShadow = true;
        child.receiveShadow = true;
      });
      weaponModels.set("akm", wrapper);
      if (weaponId === "akm") buildGun(WEAPONS.akm);
    });
    const detailedPistolUrl = new URL("./models/locarem/Glock_HighPoly.obj", window.location.href).href;
    new OBJLoader().load(detailedPistolUrl, (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      object.position.sub(center);
      object.rotation.x = Math.PI / 2;
      const wrapper = new THREE.Group();
      wrapper.userData.detailedViewmodel = true;
      wrapper.userData.viewScale = 0.055;
      wrapper.userData.viewRotationY = -Math.PI / 2;
      wrapper.userData.viewPositionZ = -0.17;
      wrapper.userData.viewMuzzleZ = -0.42;
      wrapper.add(object);
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const upgraded = sourceMaterials.map((_, index) => new THREE.MeshPhysicalMaterial({
          color: index === 0 || index === 2 ? 0x1b1e20 : 0x111617,
          roughness: index === 0 || index === 2 ? 0.22 : 0.68,
          metalness: index === 0 || index === 2 ? 0.9 : 0.16,
          clearcoat: 0.1,
          clearcoatRoughness: 0.48,
          envMapIntensity: 1.18,
        }));
        child.material = Array.isArray(child.material) ? upgraded : upgraded[0];
        child.castShadow = true;
        child.receiveShadow = true;
      });
      weaponModels.set("v9", wrapper);
      if (weaponId === "v9") buildGun(WEAPONS.v9);
    });
    const karambitUrl = new URL("./models/joshas/karambit.glb", window.location.href).href;
    new GLTFLoader().load(karambitUrl, ({ scene: knifeScene }) => {
      const ringPivot = new THREE.Vector3(3.24, 0.3, -4.41);
      knifeScene.position.sub(ringPivot);
      knifeScene.rotation.x = -Math.PI / 2;
      knifeScene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const upgraded = materials.map((source) => {
          const blade = source.name === "BladeMetal";
          const ring = source.name === "RingAccent";
          return new THREE.MeshPhysicalMaterial({
            name: source.name,
            color: blade ? 0x4b7180 : ring ? 0xd65724 : 0x101718,
            roughness: blade ? 0.14 : ring ? 0.24 : 0.42,
            metalness: blade ? 0.98 : ring ? 0.9 : 0.38,
            clearcoat: blade ? 0.34 : ring ? 0.26 : 0.08,
            clearcoatRoughness: blade ? 0.16 : 0.24,
            envMapIntensity: blade ? 1.9 : 1.3,
          });
        });
        child.material = Array.isArray(child.material) ? upgraded : upgraded[0];
        child.castShadow = true;
        child.receiveShadow = true;
      });
      const wrapper = new THREE.Group();
      wrapper.userData.detailedViewmodel = true;
      wrapper.add(knifeScene);
      weaponModels.set("karambit", wrapper);
      if (weaponId === "karambit") buildGun(WEAPONS.karambit);
    });

    const audio = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const sfxLimiter = audio.createDynamicsCompressor();
    sfxLimiter.threshold.value = -14;
    sfxLimiter.knee.value = 8;
    sfxLimiter.ratio.value = 6;
    sfxLimiter.attack.value = 0.002;
    sfxLimiter.release.value = 0.13;
    sfxLimiter.connect(audio.destination);

    const noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.6), audio.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let brownNoise = 0;
    for (let i = 0; i < noiseData.length; i++) {
      const whiteNoise = Math.random() * 2 - 1;
      brownNoise = (brownNoise + whiteNoise * 0.035) / 1.035;
      noiseData[i] = THREE.MathUtils.clamp(whiteNoise * 0.72 + brownNoise * 1.7, -1, 1);
    }

    type SoundKind = "akmShot" | "pistolShot" | "botShot" | "hit" | "headshot" | "step" | "plant" | "explode" | "empty" | "slash";
    const sound = (kind: SoundKind) => {
      if (settingsRef.current.volume <= 0 || audio.state === "closed") return;
      if (audio.state === "suspended") {
        void audio.resume().then(() => sound(kind)).catch(() => undefined);
        return;
      }
      const now = audio.currentTime;
      const volume = settingsRef.current.volume;
      const playNoise = (
        filterType: BiquadFilterType,
        frequency: number,
        q: number,
        duration: number,
        level: number,
        delay = 0,
        playbackRate = 1,
      ) => {
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const gain = audio.createGain();
        const start = now + delay;
        source.buffer = noiseBuffer;
        source.playbackRate.value = playbackRate * (0.96 + Math.random() * 0.08);
        filter.type = filterType;
        filter.frequency.setValueAtTime(frequency * (0.94 + Math.random() * 0.12), start);
        filter.Q.value = q;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * level), start + 0.0015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter).connect(gain).connect(sfxLimiter);
        source.start(start, Math.random() * 0.08);
        source.stop(start + duration + 0.01);
        source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      };
      const playTone = (
        type: OscillatorType,
        startFrequency: number,
        endFrequency: number,
        duration: number,
        level: number,
        delay = 0,
      ) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = now + delay;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(startFrequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume * level), start + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain).connect(sfxLimiter);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      };

      if (kind === "akmShot") {
        playNoise("highpass", 1100, 0.8, 0.055, 0.34);
        playNoise("lowpass", 640, 0.7, 0.16, 0.24);
        playTone("triangle", 122, 46, 0.15, 0.27);
        playNoise("bandpass", 2550, 3.2, 0.022, 0.14, 0.004);
        playNoise("bandpass", 720, 0.7, 0.28, 0.065, 0.018, 0.82);
      } else if (kind === "pistolShot") {
        playNoise("highpass", 1450, 0.8, 0.04, 0.3);
        playNoise("lowpass", 980, 0.85, 0.1, 0.17);
        playTone("triangle", 185, 78, 0.105, 0.18);
        playNoise("bandpass", 3300, 4.2, 0.018, 0.13, 0.004, 1.12);
        playNoise("bandpass", 1050, 0.8, 0.17, 0.045, 0.014, 0.94);
      } else if (kind === "botShot") {
        playNoise("bandpass", 920, 0.75, 0.085, 0.095);
        playTone("triangle", 105, 48, 0.11, 0.055);
        playNoise("lowpass", 520, 0.6, 0.18, 0.032, 0.012, 0.84);
      } else if (kind === "headshot") {
        playNoise("highpass", 2700, 0.7, 0.028, 0.19);
        playNoise("bandpass", 1450, 5.5, 0.052, 0.11, 0.004, 1.16);
        playTone("sine", 1880, 940, 0.074, 0.105, 0.002);
        playTone("triangle", 540, 190, 0.052, 0.115);
      } else if (kind === "hit") {
        playNoise("bandpass", 1250, 3.8, 0.024, 0.055);
        playTone("triangle", 720, 420, 0.034, 0.046);
      } else if (kind === "step") {
        playNoise("lowpass", 145, 0.7, 0.055, 0.032);
        playTone("sine", 68, 42, 0.04, 0.022);
      } else if (kind === "plant") {
        playTone("square", 880, 620, 0.11, 0.05);
      } else if (kind === "explode") {
        playNoise("lowpass", 230, 0.55, 0.4, 0.22);
        playNoise("bandpass", 680, 0.7, 0.24, 0.11, 0.005, 0.72);
        playTone("sawtooth", 52, 22, 0.38, 0.14);
      } else if (kind === "empty") {
        playNoise("bandpass", 2850, 5, 0.022, 0.045);
        playTone("square", 235, 145, 0.03, 0.028);
      } else if (kind === "slash") {
        playNoise("highpass", 850, 0.8, 0.11, 0.075, 0, 1.34);
        playTone("triangle", 180, 86, 0.085, 0.035);
      }
    };

    const createBotModel = (team: Team, id: string) => {
      const group = new THREE.Group();
      group.userData.botId = id;
      const fallbackBody = new THREE.Group();
      const uniform = new THREE.MeshStandardMaterial({ color: team === "attack" ? 0x624734 : 0x2b505c, roughness: 0.9, metalness: 0.02 });
      const fabric = new THREE.MeshStandardMaterial({ color: 0x171d1c, roughness: 0.98, metalness: 0 });
      const webbing = new THREE.MeshStandardMaterial({ color: 0x252b28, roughness: 0.88, metalness: 0.05 });
      const armor = new THREE.MeshStandardMaterial({ color: 0x101617, roughness: 0.5, metalness: 0.42 });
      const vestArmor = armor.clone();
      const metal = new THREE.MeshStandardMaterial({ color: 0x252d2f, roughness: 0.27, metalness: 0.86 });
      const skin = new THREE.MeshStandardMaterial({ color: 0x876852, roughness: 0.92 });
      const lens = new THREE.MeshPhysicalMaterial({ color: 0x1a4b58, emissive: 0x0d2730, emissiveIntensity: 0.34, metalness: 0.48, roughness: 0.07, transmission: 0.16, transparent: true, opacity: 0.93, clearcoat: 0.5 });
      const patch = new THREE.MeshStandardMaterial({ color: team === "attack" ? 0xdc682b : 0x42b8cf, roughness: 0.48, metalness: 0.24 });

      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.16, 0.52, 12), uniform);
      torso.scale.z = 0.64;
      torso.position.y = 1.22;
      torso.userData.uniform = true;
      const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.25, 10), uniform);
      abdomen.scale.z = 0.66;
      abdomen.position.y = 0.91;
      abdomen.userData.uniform = true;
      const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.2, 0.24, 3, 0.045), fabric);
      pelvis.position.y = 0.76;
      const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.17, 0.45, 12), vestArmor);
      vest.scale.z = 0.62;
      vest.position.set(0, 1.23, -0.015);
      vest.userData.vest = true;
      const frontPlate = new THREE.Mesh(new RoundedBoxGeometry(0.29, 0.29, 0.035, 3, 0.012), vestArmor);
      frontPlate.position.set(0, 1.27, -0.145);
      frontPlate.userData.vest = true;
      const belt = new THREE.Mesh(new RoundedBoxGeometry(0.37, 0.075, 0.25, 2, 0.015), webbing);
      belt.position.set(0, 0.82, -0.01);
      const backpack = new THREE.Mesh(new RoundedBoxGeometry(0.31, 0.4, 0.13, 3, 0.03), fabric);
      backpack.position.set(0, 1.22, 0.18);

      for (const [x, rotation] of [[-0.105, -0.22], [0.105, 0.22]] as const) {
        const strap = new THREE.Mesh(new RoundedBoxGeometry(0.038, 0.43, 0.025, 2, 0.008), webbing);
        strap.position.set(x, 1.26, -0.154);
        strap.rotation.z = rotation;
        fallbackBody.add(strap);
      }
      for (const x of [-0.125, 0, 0.125]) {
        const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.13, 0.055, 2, 0.014), webbing);
        pouch.position.set(x, 1.07, -0.17);
        fallbackBody.add(pouch);
      }

      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.09, 0.13, 10), fabric);
      neck.position.y = 1.56;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), fabric);
      head.scale.set(0.92, 1.12, 0.88);
      head.position.y = 1.72;
      head.userData.part = "head";
      const eyeOpening = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.058, 0.02, 3, 0.01), skin);
      eyeOpening.position.set(0, 1.755, -0.13);
      eyeOpening.userData.part = "head";
      const maskPanel = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.095, 0.025, 3, 0.012), fabric);
      maskPanel.position.set(0, 1.65, -0.125);
      maskPanel.userData.part = "head";
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), armor);
      helmet.scale.z = 1.03;
      helmet.position.y = 1.79;
      helmet.userData.part = "head";
      const helmetBrim = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.032, 0.1, 2, 0.011), armor);
      helmetBrim.position.set(0, 1.79, -0.09);
      helmetBrim.userData.part = "head";
      const gogglesFrame = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.064, 0.031, 3, 0.013), armor);
      gogglesFrame.position.set(0, 1.76, -0.15);
      gogglesFrame.userData.part = "head";
      const lensA = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.04, 0.011, 3, 0.009), lens);
      const lensB = lensA.clone();
      lensA.position.set(-0.049, 1.76, -0.168);
      lensB.position.set(0.049, 1.76, -0.168);
      lensA.userData.part = "head";
      lensB.userData.part = "head";
      const headsetA = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), armor);
      const headsetB = headsetA.clone();
      headsetA.rotation.z = Math.PI / 2;
      headsetB.rotation.z = Math.PI / 2;
      headsetA.position.set(-0.15, 1.69, 0);
      headsetB.position.set(0.15, 1.69, 0);

      const createLeg = (side: -1 | 1) => {
        const limb = new THREE.Group();
        limb.position.set(side * 0.11, 0.78, 0);
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.071, 0.27, 5, 9), uniform);
        thigh.position.y = -0.2;
        thigh.userData.uniform = true;
        const knee = new THREE.Mesh(new RoundedBoxGeometry(0.135, 0.13, 0.07, 2, 0.022), armor);
        knee.position.set(0, -0.4, -0.075);
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.25, 5, 9), fabric);
        shin.position.y = -0.58;
        const boot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.13, 0.27, 3, 0.032), armor);
        boot.position.set(0, -0.79, -0.05);
        limb.add(thigh, knee, shin, boot);
        return limb;
      };
      const legA = createLeg(-1);
      const legB = createLeg(1);

      const createArm = (side: -1 | 1) => {
        const limb = new THREE.Group();
        limb.position.set(side * 0.255, 1.43, -0.005);
        const shoulder = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.14, 0.18, 3, 0.035), armor);
        shoulder.position.y = -0.015;
        const insignia = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.07, 0.075, 2, 0.008), patch);
        insignia.position.set(side * 0.076, -0.02, -0.025);
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.057, 0.2, 5, 9), uniform);
        upper.position.y = -0.16;
        upper.userData.uniform = true;
        const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.061, 10, 8), fabric);
        elbow.position.y = -0.33;
        const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.19, 5, 9), fabric);
        forearm.position.set(-side * 0.035, -0.43, -0.08);
        forearm.rotation.x = 0.48;
        const glove = new THREE.Mesh(new THREE.SphereGeometry(0.063, 10, 8), fabric);
        glove.position.set(-side * 0.065, -0.55, -0.16);
        limb.add(shoulder, insignia, upper, elbow, forearm, glove);
        return limb;
      };
      const armA = createArm(-1);
      const armB = createArm(1);
      armA.rotation.set(-0.82, 0, 0.16);
      armB.rotation.set(-1.02, 0, -0.24);

      const weaponMount = new THREE.Group();
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

      weaponMount.add(weaponBody, weaponBarrel, weaponStock, weaponMag);
      group.userData.weaponMount = weaponMount;
      group.userData.legA = legA;
      group.userData.legB = legB;
      group.userData.armA = armA;
      group.userData.armB = armB;
      group.userData.fallbackBody = fallbackBody;
      fallbackBody.add(torso, abdomen, pelvis, vest, frontPlate, belt, backpack, neck, head, eyeOpening, maskPanel, helmet, helmetBrim, gogglesFrame, lensA, lensB, headsetA, headsetB, legA, legB, armA, armB);
      group.add(fallbackBody, weaponMount);
      group.traverse((child) => {
        child.userData.botId = id;
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      refreshBotWeaponModel(group);
      scene.add(group);
      return group;
    };

    for (let i = 0; i < 20; i++) {
      const team: Team = i % 2 === 0 ? "attack" : "defend";
      const id = `bot-${i}`;
      const root = createBotModel(team, id);
      bots.push({
        id,
        name: BOT_NAMES[i],
        team,
        root,
        health: 100,
        alive: true,
        kills: 0,
        deaths: 0,
        fireCooldown: 0,
        decisionCooldown: 0,
        destination: new THREE.Vector3(),
        skill: 0.62,
        carryingBomb: false,
        defuseProgress: 0,
        deathTime: -1,
        deathStart: new THREE.Vector3(),
        deathStartQuaternion: new THREE.Quaternion(),
        deathTargetQuaternion: new THREE.Quaternion(),
        deathDrift: new THREE.Vector3(),
        respawnAt: 0,
      });
    }

    const soldierUrl = new URL("./models/joshas/elite-soldier.glb", window.location.href).href;
    new GLTFLoader().load(soldierUrl, ({ scene: soldierTemplate }) => {
      bots.forEach((bot) => {
        const oldCosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
        if (oldCosmetic) bot.root.remove(oldCosmetic);
        const oldGear = bot.root.userData.soldierGear as THREE.Group | undefined;
        if (oldGear) bot.root.remove(oldGear);
        const soldier = soldierTemplate.clone(true);
        soldier.rotation.y = Math.PI;
        soldier.traverse((child) => {
          child.userData.botId = bot.id;
          const name = child.name.toLowerCase();
          if (name.includes("head") || name.includes("face") || name.includes("hat") || name.includes("eye") || name.includes("pupil")) child.userData.part = "head";
          if (!(child instanceof THREE.Mesh)) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          const cloned = materials.map((source) => {
            const material = source.clone() as THREE.MeshStandardMaterial;
            material.roughness = name.includes("steel") ? 0.28 : name.includes("eye") ? 0.2 : 0.82;
            material.metalness = name.includes("steel") ? 0.78 : 0.04;
            material.envMapIntensity = name.includes("steel") ? 1.25 : 0.72;
            return material;
          });
          child.material = Array.isArray(child.material) ? cloned : cloned[0];
          child.userData.uniform = name === "arms" || name === "legs";
          child.userData.vest = name === "vest";
          child.castShadow = true;
          child.receiveShadow = true;
        });
        const fallbackBody = bot.root.userData.fallbackBody as THREE.Group;
        fallbackBody.visible = false;
        const gear = new THREE.Group();
        const goggleFrame = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.052, 0.024, 3, 0.01), new THREE.MeshStandardMaterial({ color: 0x0d1314, roughness: 0.38, metalness: 0.48 }));
        const goggleLensMaterial = new THREE.MeshPhysicalMaterial({ color: 0x174c5c, emissive: 0x09262f, emissiveIntensity: 0.32, roughness: 0.06, metalness: 0.42, clearcoat: 0.5 });
        const goggleA = new THREE.Mesh(new RoundedBoxGeometry(0.062, 0.032, 0.011, 3, 0.007), goggleLensMaterial);
        const goggleB = goggleA.clone();
        const vestPlate = new THREE.Mesh(
          new RoundedBoxGeometry(0.3, 0.31, 0.038, 3, 0.012),
          new THREE.MeshStandardMaterial({ color: 0xc63d35, roughness: 0.62, metalness: 0.18 }),
        );
        const vestBack = vestPlate.clone();
        goggleFrame.position.set(0, 1.665, -0.147);
        goggleA.position.set(-0.043, 1.665, -0.162);
        goggleB.position.set(0.043, 1.665, -0.162);
        vestPlate.position.set(0, 1.2, -0.17);
        vestBack.position.set(0, 1.2, 0.13);
        vestPlate.userData.vest = true;
        vestBack.userData.vest = true;
        gear.add(goggleFrame, goggleA, goggleB, vestPlate, vestBack);
        gear.traverse((child) => {
          child.userData.botId = bot.id;
          child.userData.part = child.userData.vest ? "body" : "head";
          if (child instanceof THREE.Mesh) child.castShadow = true;
        });
        bot.root.userData.soldierCosmetic = soldier;
        bot.root.userData.soldierGear = gear;
        bot.root.add(soldier, gear);
        updateBotVest(bot);
      });
    });

    let screenActive = false;
    let simulationPaused = true;
    let gameMode: GameMode = "demolition";
    let trainingMode = false;
    let freeForAllMode = false;
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
    let viewmodelSwayX = 0;
    let viewmodelSwayY = 0;
    let inspectStartedAt = -10;
    let inspectDuration = 0;
    let jumpHeight = 0;
    let jumpVelocity = 0;
    let aiming = false;
    let playerDeathTime = 0;
    let playerDeathStartY = 1.68;
    let playerDeathRoll = 0;
    let playerProtectedUntil = 0;
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
    const timer = new THREE.Timer();
    timer.connect(document);
    const particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; spin?: THREE.Vector3 }[] = [];
    const tracers: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
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
      const baseZ = team === "attack" ? 35 : -35;
      return new THREE.Vector3((index % 5 - 2) * 1.45, 0, baseZ + Math.floor(index / 5) * (team === "attack" ? -1.4 : 1.4));
    };
    const ffaSpawns = [
      [-36, 35], [36, 35], [0, 35], [-36, 15], [36, 15], [-18, 3], [18, 3],
      [-36, -15], [36, -15], [0, -18], [-18, -23], [18, -23], [-36, -36],
      [36, -36], [0, -36], [-20, 17], [20, 17], [-15, -3], [15, -3], [0, 4], [0, 27],
    ] as const;
    let ffaSpawnCursor = 0;
    const nextFfaSpawn = () => {
      const point = ffaSpawns[ffaSpawnCursor % ffaSpawns.length];
      // Eight is coprime with the 21-point list, so each full rotation visits every spawn.
      ffaSpawnCursor += 8;
      return new THREE.Vector3(point[0] + (Math.random() - 0.5) * 0.8, 0, point[1] + (Math.random() - 0.5) * 0.8);
    };

    const collides = (x: number, z: number, radius = 0.42) => {
      if (x < -39.5 || x > 39.5 || z < -39.5 || z > 39.5) return true;
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
      inspectDuration = 0;
      buildGun(WEAPONS[id]);
    };
    const inspectKnife = () => {
      if (weaponId !== "karambit" || !playerAlive) return;
      inspectStartedAt = performance.now() / 1000;
      inspectDuration = 1.65;
      firing = false;
      sound("slash");
    };

    const setDifficulty = (value: Difficulty) => {
      const skill = value === "recruit" ? 0.43 : value === "veteran" ? 0.64 : 0.82;
      bots.forEach((bot) => { bot.skill = skill + (Math.random() - 0.5) * 0.12; });
    };

    const updateBotVest = (bot: Bot) => {
      const isEnemy = freeForAllMode || bot.team !== playerTeam;
      bot.root.traverse((child) => {
        if (!child.userData.vest || !(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          const tacticalMaterial = material as THREE.MeshStandardMaterial;
          tacticalMaterial.color.setHex(isEnemy ? 0xc63d35 : 0x416a73);
          tacticalMaterial.emissive?.setHex(isEnemy ? 0x220504 : 0x031417);
          tacticalMaterial.emissiveIntensity = isEnemy ? 0.14 : 0.06;
          tacticalMaterial.needsUpdate = true;
        });
      });
    };

    const beginRound = () => {
      roundEndQueued = false;
      playerTeam = trainingMode ? "attack" : roundNumber <= 6 ? "attack" : "defend";
      phase = freeForAllMode ? "live" : "buy";
      phaseTime = freeForAllMode ? 0 : trainingMode ? 6 : 12;
      roundTime = freeForAllMode ? 300 : trainingMode ? 180 : 105;
      roundMessage = "";
      playerHealth = 100;
      playerAlive = true;
      playerArmor = freeForAllMode ? 100 : Math.min(playerArmor, 100);
      playerCarryingBomb = !freeForAllMode && !trainingMode && playerTeam === "attack";
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
      camera.position.copy(freeForAllMode ? nextFfaSpawn() : spawnByTeam(playerTeam, 0)).setY(1.68);
      yaw = freeForAllMode ? Math.random() * Math.PI * 2 : playerTeam === "attack" ? 0 : Math.PI;
      pitch = 0;
      jumpHeight = 0;
      jumpVelocity = 0;
      aiming = false;
      playerDeathTime = 0;
      playerDeathStartY = 1.68;
      playerDeathRoll = 0;
      viewmodelSwayX = 0;
      viewmodelSwayY = 0;
      gun.visible = true;
      gun.rotation.set(0, 0, 0);
      velocity.set(0, 0, 0);
      bots.forEach((bot, index) => {
        const active = freeForAllMode || index < 9;
        bot.team = freeForAllMode ? (index % 2 === 0 ? "attack" : "defend") : index < 4 ? playerTeam : otherTeam(playerTeam);
        bot.root.traverse((child) => {
          if (child.userData.uniform && child instanceof THREE.Mesh) {
            const ffaColor = new THREE.Color().setHSL((index * 0.127 + 0.02) % 1, 0.26, 0.25);
            (child.material as THREE.MeshStandardMaterial).color.copy(freeForAllMode ? ffaColor : new THREE.Color(bot.team === "attack" ? 0x65402f : 0x2d4e58));
          }
        });
        updateBotVest(bot);
        bot.health = 100;
        bot.alive = active;
        bot.root.visible = active;
        bot.fireCooldown = 0.5 + Math.random();
        bot.decisionCooldown = 0;
        bot.defuseProgress = 0;
        bot.carryingBomb = false;
        bot.deathTime = -1;
        bot.respawnAt = 0;
        if (!active) return;
        const teamIndex = index < 4 ? index : index - 4;
        bot.root.position.copy(freeForAllMode ? nextFfaSpawn() : spawnByTeam(bot.team, teamIndex + (bot.team === playerTeam ? 1 : 0)));
        bot.root.rotation.set(0, freeForAllMode ? Math.random() * Math.PI * 2 : bot.team === "attack" ? 0 : Math.PI, 0);
        const legA = bot.root.userData.legA as THREE.Mesh;
        const legB = bot.root.userData.legB as THREE.Mesh;
        const armA = bot.root.userData.armA as THREE.Mesh;
        const armB = bot.root.userData.armB as THREE.Mesh;
        legA.rotation.set(0, 0, 0);
        legB.rotation.set(0, 0, 0);
        armA.rotation.set(-0.82, 0, 0.2);
        armB.rotation.set(-1.02, 0, -0.3);
        const cosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
        if (cosmetic) {
          cosmetic.position.y = 0;
          cosmetic.rotation.z = 0;
        }
        bot.destination.copy(freeForAllMode ? nextFfaSpawn() : (index % 2 ? zoneA : zoneB));
      });
      if (trainingMode) {
        bots.filter((b) => b.team === "attack").forEach((b) => { b.root.visible = false; b.alive = false; });
        const targetPositions = [
          new THREE.Vector3(-20, 0, 20),
          new THREE.Vector3(-16, 0, 16),
          new THREE.Vector3(-11, 0, 20),
          new THREE.Vector3(-19, 0, 11),
        ];
        bots.filter((b) => b.team === "defend").forEach((b, i) => {
          if (i > 3) {
            b.root.visible = false;
            b.alive = false;
            return;
          }
          b.root.position.copy(targetPositions[i]);
          b.root.rotation.set(0, Math.PI * 0.75, 0);
          b.destination.copy(targetPositions[i]);
        });
      }
      if (!ammo.v9) ammo.v9 = { clip: WEAPONS.v9.magazine, reserve: WEAPONS.v9.reserve };
      if (!ammo.karambit) ammo.karambit = { clip: 1, reserve: 0 };
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

    const finishFreeForAll = (winner: string) => {
      if (phase === "matchEnd") return;
      phase = "matchEnd";
      roundMessage = winner === "YOU" ? "FREE FOR ALL CHAMPION" : `${winner} WINS THE ARENA`;
      document.exitPointerLock?.();
      try {
        const raw = localStorage.getItem("breachline.stats");
        const saved = raw ? JSON.parse(raw) : { matches: 0, wins: 0, eliminations: 0 };
        const next = { matches: saved.matches + 1, wins: saved.wins + (winner === "YOU" ? 1 : 0), eliminations: saved.eliminations + playerKills };
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

    const damageBot = (bot: Bot, damage: number, attackerName: string, weapon: string, attackerTeam: Team, hitDirection?: THREE.Vector3, isHeadshot = false) => {
      if (!bot.alive) return;
      bot.health -= damage;
      if (attackerName === "YOU") {
        hitMarkerUntil = performance.now() + 110;
        sound(isHeadshot ? "headshot" : "hit");
      }
      if (bot.health <= 0) {
        bot.alive = false;
        bot.root.visible = true;
        bot.deathTime = 0;
        bot.deathStart.copy(bot.root.position);
        bot.deathStartQuaternion.copy(bot.root.quaternion);
        const fallDirection = hitDirection?.clone().setY(0) ?? new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
        if (fallDirection.lengthSq() < 0.001) fallDirection.set(0, 0, 1);
        fallDirection.normalize();
        bot.deathDrift.copy(fallDirection).multiplyScalar(0.42 + Math.random() * 0.22);
        const fallRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fallDirection);
        bot.deathTargetQuaternion.copy(fallRotation.multiply(bot.deathStartQuaternion));
        bot.deaths += 1;
        addFeed(attackerName, bot.name, weapon, !freeForAllMode && attackerTeam === bot.team);
        if (attackerName === "YOU") {
          playerKills += 1;
          playerMoney = Math.min(16000, playerMoney + (!freeForAllMode && attackerTeam === bot.team ? 0 : 300));
          if (freeForAllMode && playerKills >= 30) finishFreeForAll("YOU");
        } else {
          const killer = bots.find((b) => b.name === attackerName);
          if (killer) {
            killer.kills += 1;
            if (freeForAllMode && killer.kills >= 30) finishFreeForAll(killer.name);
          }
        }
        if (freeForAllMode) bot.respawnAt = performance.now() / 1000 + 2.2;
        else if (trainingMode) bot.respawnAt = performance.now() / 1000 + 1.25;
        if (bot.carryingBomb) {
          const nextCarrier = bots.find((b) => b.team === "attack" && b.alive);
          if (nextCarrier) nextCarrier.carryingBomb = true;
        }
      }
    };

    const damagePlayer = (damage: number, attacker: Bot) => {
      if (!playerAlive) return;
      if (freeForAllMode && performance.now() / 1000 < playerProtectedUntil) return;
      const absorbed = Math.min(playerArmor, damage * 0.42);
      playerArmor -= absorbed;
      playerHealth -= damage - absorbed;
      damageFlashUntil = performance.now() + 150;
      if (playerHealth <= 0) {
        playerHealth = 0;
        playerAlive = false;
        playerDeathTime = 0;
        playerDeathStartY = camera.position.y;
        playerDeathRoll = (Math.random() < 0.5 ? -1 : 1) * (0.72 + Math.random() * 0.28);
        firing = false;
        aiming = false;
        playerDeaths += 1;
        attacker.kills += 1;
        addFeed(attacker.name, "YOU", "AKM");
        if (freeForAllMode && attacker.kills >= 30) finishFreeForAll(attacker.name);
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

    const spawnTracer = (start: THREE.Vector3, end: THREE.Vector3, color = 0xffc47d) => {
      const direction = end.clone().sub(start);
      const length = direction.length();
      if (length < 0.05) return;
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, length, 4), material);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      scene.add(mesh);
      tracers.push({ mesh, life: 0.07, maxLife: 0.07 });
    };

    const spawnCasing = () => {
      const casing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.038, 8),
        new THREE.MeshStandardMaterial({ color: 0xb98532, roughness: 0.28, metalness: 0.9 }),
      );
      casing.rotation.z = Math.PI / 2;
      const ejectionPoint = new THREE.Vector3(0.13, 0.08, -0.12);
      gun.localToWorld(ejectionPoint);
      casing.position.copy(ejectionPoint);
      scene.add(casing);
      const casingVelocity = new THREE.Vector3(1.55, 1.05, 0.22).applyQuaternion(camera.quaternion);
      particles.push({ mesh: casing, velocity: casingVelocity, life: 1.15, spin: new THREE.Vector3(9, 15, 6) });
    };

    const fireShot = () => {
      if (!screenActive || !playerAlive || phase === "roundEnd" || phase === "matchEnd") return;
      const now = performance.now() / 1000;
      const weapon = currentWeapon();
      if (now < nextShotAt || now < reloadingUntil) return;
      if (weapon.category === "melee") {
        firing = false;
        nextShotAt = now + weapon.fireRate;
        recoil = 0.18;
        sound("slash");
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        raycaster.set(camera.position, direction);
        raycaster.far = 2.45;
        const targets = bots.filter((bot) => bot.alive && (freeForAllMode || bot.team !== playerTeam)).map((bot) => bot.root);
        const botHit = raycaster.intersectObjects(targets, true)[0];
        const wallHit = raycaster.intersectObjects(obstacleMeshes, false)[0];
        if (botHit && (!wallHit || botHit.distance < wallHit.distance)) {
          const bot = bots.find((candidate) => candidate.id === botHit.object.userData.botId);
          if (bot) {
            damageBot(bot, weapon.damage, "YOU", weapon.short, playerTeam, direction);
            spawnImpact(botHit.point, 0xff5a3d);
          }
        }
        return;
      }
      const mag = ammo[weapon.id];
      if (!mag || mag.clip <= 0) {
        sound("empty");
        nextShotAt = now + 0.25;
        return;
      }
      if (!weapon.auto) firing = false;
      mag.clip -= 1;
      nextShotAt = now + weapon.fireRate;
      recoil = Math.min(0.16, recoil + (weapon.id === "akm" ? 0.042 : 0.032));
      pitch = clamp(pitch + weapon.spread * 0.75, -1.2, 1.2);
      muzzle.intensity = 14;
      muzzleFlash.visible = true;
      muzzleFlash.rotation.z = Math.random() * Math.PI;
      window.setTimeout(() => { muzzle.intensity = 0; muzzleFlash.visible = false; }, 38);
      sound(weapon.id === "akm" ? "akmShot" : "pistolShot");
      spawnCasing();

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
        const botTargets = bots.filter((b) => b.alive && (freeForAllMode || b.team !== playerTeam)).map((b) => b.root);
        const botHits = raycaster.intersectObjects(botTargets, true);
        const wallHits = raycaster.intersectObjects(obstacleMeshes, false);
        const botHit = botHits[0];
        const wallHit = wallHits[0];
        const endPoint = botHit && (!wallHit || botHit.distance < wallHit.distance)
          ? botHit.point.clone()
          : wallHit?.point.clone() ?? camera.position.clone().addScaledVector(direction, 70);
        if (botHit && (!wallHit || botHit.distance < wallHit.distance)) {
          const botId = botHit.object.userData.botId as string;
          const bot = bots.find((b) => b.id === botId);
          if (bot) {
            const headshot = botHit.object.userData.part === "head";
            damageBot(bot, weapon.damage * (headshot ? 2.3 : 1), "YOU", weapon.short, playerTeam, direction, headshot);
            spawnImpact(botHit.point, headshot ? 0xff4d32 : 0xffa95a);
          }
        } else if (wallHit) {
          spawnImpact(wallHit.point, 0xffc58b);
        }
        spawnTracer(muzzle.getWorldPosition(new THREE.Vector3()), endPoint);
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
        damageBot(bot, Math.max(12, 108 - distance * 12), "YOU", "FRAG", playerTeam, bot.root.position.clone().sub(position).normalize());
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
      const opponents = bots.filter((b) => b !== bot && b.alive && (freeForAllMode || b.team !== bot.team));
      let target: { position: THREE.Vector3; bot?: Bot; player?: boolean } | null = null;
      let best = Infinity;
      for (const opponent of opponents) {
        const dist = bot.root.position.distanceTo(opponent.root.position);
        if (dist < best) { best = dist; target = { position: opponent.root.position, bot: opponent }; }
      }
      const playerTargetable = !freeForAllMode || performance.now() / 1000 >= playerProtectedUntil;
      if (playerAlive && playerTargetable && (freeForAllMode || playerTeam !== bot.team)) {
        const dist = bot.root.position.distanceTo(camera.position);
        if (dist < best) target = { position: camera.position, player: true };
      }
      return target;
    };

    const updateBots = (dt: number) => {
      for (const bot of bots) {
        if (bot.alive || bot.deathTime < 0 || !bot.root.visible) continue;
        if ((freeForAllMode || trainingMode) && bot.respawnAt > 0 && performance.now() / 1000 >= bot.respawnAt) {
          bot.health = 100;
          bot.alive = true;
          bot.deathTime = -1;
          bot.respawnAt = 0;
          bot.root.position.copy(freeForAllMode ? nextFfaSpawn() : bot.destination);
          bot.root.quaternion.identity();
          bot.root.rotation.y = Math.random() * Math.PI * 2;
          if (freeForAllMode) bot.destination.copy(nextFfaSpawn());
          bot.fireCooldown = 0.8 + Math.random() * 0.6;
          const legA = bot.root.userData.legA as THREE.Mesh;
          const legB = bot.root.userData.legB as THREE.Mesh;
          const armA = bot.root.userData.armA as THREE.Mesh;
          const armB = bot.root.userData.armB as THREE.Mesh;
          legA.rotation.set(0, 0, 0);
          legB.rotation.set(0, 0, 0);
          armA.rotation.set(-0.82, 0, 0.2);
          armB.rotation.set(-1.02, 0, -0.3);
          const cosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
          if (cosmetic) {
            cosmetic.position.y = 0;
            cosmetic.rotation.z = 0;
          }
          continue;
        }
        bot.deathTime = Math.min(freeForAllMode ? 2.4 : 1.2, bot.deathTime + dt);
        const fallT = clamp(bot.deathTime / 0.62, 0, 1);
        const eased = 1 - Math.pow(1 - fallT, 3);
        bot.root.position.copy(bot.deathStart).addScaledVector(bot.deathDrift, eased);
        bot.root.position.y = THREE.MathUtils.lerp(bot.deathStart.y, 0.075, eased);
        bot.root.quaternion.slerpQuaternions(bot.deathStartQuaternion, bot.deathTargetQuaternion, eased);
        const legA = bot.root.userData.legA as THREE.Mesh;
        const legB = bot.root.userData.legB as THREE.Mesh;
        const armA = bot.root.userData.armA as THREE.Mesh;
        const armB = bot.root.userData.armB as THREE.Mesh;
        legA.rotation.z = THREE.MathUtils.lerp(legA.rotation.z, 0.24, dt * 7);
        legB.rotation.z = THREE.MathUtils.lerp(legB.rotation.z, -0.28, dt * 7);
        armA.rotation.set(
          THREE.MathUtils.lerp(armA.rotation.x, -0.15, dt * 7),
          0,
          THREE.MathUtils.lerp(armA.rotation.z, 1.05, dt * 7),
        );
        armB.rotation.set(
          THREE.MathUtils.lerp(armB.rotation.x, 0.2, dt * 7),
          0,
          THREE.MathUtils.lerp(armB.rotation.z, -1.08, dt * 7),
        );
      }
      if (phase !== "live") return;
      for (const bot of bots) {
        if (!bot.alive) continue;
        const legA = bot.root.userData.legA as THREE.Mesh;
        const legB = bot.root.userData.legB as THREE.Mesh;
        const armA = bot.root.userData.armA as THREE.Mesh;
        const armB = bot.root.userData.armB as THREE.Mesh;
        if (trainingMode) {
          const idle = Math.sin(performance.now() * 0.002 + Number(bot.id.split("-")[1])) * 0.035;
          armA.rotation.x = -0.82 + idle;
          armB.rotation.x = -1.02 - idle;
          const cosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
          if (cosmetic) cosmetic.position.y = idle * 0.08;
          continue;
        }
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
          const cosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
          if (cosmetic) {
            cosmetic.position.y = THREE.MathUtils.lerp(cosmetic.position.y, 0, dt * 9);
            cosmetic.rotation.z = THREE.MathUtils.lerp(cosmetic.rotation.z, 0, dt * 9);
          }
          if (bot.fireCooldown <= 0) {
            bot.fireCooldown = 0.18 + (1 - bot.skill) * 0.35 + Math.random() * 0.12;
            const distance = bot.root.position.distanceTo(target.position);
            const hitChance = clamp(bot.skill * (1 - distance / 70), 0.16, 0.82);
            const shotEnd = targetEye.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.42, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.42));
            spawnTracer(botEye, shotEnd, 0xff9a55);
            if (distance < 24) sound("botShot");
            if (Math.random() < hitChance) {
              if (target.player) damagePlayer(9 + Math.random() * 13, bot);
              else if (target.bot) damageBot(target.bot, 11 + Math.random() * 15, bot.name, "AKM", bot.team, target.bot.root.position.clone().sub(bot.root.position).normalize());
            }
          }
          continue;
        }

        if (freeForAllMode) {
          if (bot.decisionCooldown <= 0 || bot.root.position.distanceTo(bot.destination) < 1.2) {
            bot.destination.copy(nextFfaSpawn());
            bot.decisionCooldown = 1.2 + Math.random() * 2.2;
          }
        } else if (bot.team === "attack") {
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
          bot.destination.copy(freeForAllMode ? nextFfaSpawn() : new THREE.Vector3((Math.random() - 0.5) * 66, 0, (Math.random() - 0.5) * 66));
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
        const cosmetic = bot.root.userData.soldierCosmetic as THREE.Group | undefined;
        if (cosmetic) {
          cosmetic.position.y = Math.abs(stride) * 0.045;
          cosmetic.rotation.z = stride * 0.022;
        }
      }
    };

    const updateObjective = (dt: number) => {
      actionText = "";
      if (freeForAllMode || trainingMode || phase !== "live" || !playerAlive) return;
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
      const targetFov = aiming && currentWeapon().category !== "melee" ? (weaponId === "akm" ? 58 : 64) : settingsRef.current.fov;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, dt * 8);
      camera.updateProjectionMatrix();
      viewmodelSwayX = THREE.MathUtils.lerp(viewmodelSwayX, 0, dt * 7.5);
      viewmodelSwayY = THREE.MathUtils.lerp(viewmodelSwayY, 0, dt * 7.5);
      if (!playerAlive) {
        playerDeathTime += dt;
        const fallT = clamp(playerDeathTime / 0.72, 0, 1);
        const eased = 1 - Math.pow(1 - fallT, 3);
        camera.position.y = THREE.MathUtils.lerp(playerDeathStartY, 0.31, eased);
        camera.rotation.set(pitch + eased * 0.14, yaw, playerDeathRoll * eased);
        gun.position.y -= dt * 1.9;
        gun.rotation.z += dt * playerDeathRoll * 2.1;
        if (playerDeathTime > 0.24) gun.visible = false;
        return;
      }
      if (phase === "roundEnd" || phase === "matchEnd") return;
      const forwardInput = (keys.has("KeyW") || touchKeys.has("forward") ? 1 : 0) - (keys.has("KeyS") || touchKeys.has("back") ? 1 : 0);
      const sideInput = (keys.has("KeyD") || touchKeys.has("right") ? 1 : 0) - (keys.has("KeyA") || touchKeys.has("left") ? 1 : 0);
      const crouched = keys.has("ControlLeft") || touchKeys.has("crouch");
      const jumpHeld = keys.has("Space") || touchKeys.has("jump");
      const sprinting = (keys.has("ShiftLeft") || touchKeys.has("sprint")) && forwardInput > 0 && !crouched;
      const speed = sprinting ? 7.3 : crouched ? 2.8 : 5.2;
      const airborne = jumpHeight > 0.01 || jumpVelocity > 0.01;
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const desired = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(sideInput));
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(speed);
      velocity.lerp(desired, 1 - Math.exp(-dt * (airborne ? 2.25 : 10)));
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
      if (jumpHeight < 0) {
        jumpHeight = 0;
        jumpVelocity = 0;
        if (jumpHeld && playerAlive && !crouched) {
          jumpHeight = 0.002;
          jumpVelocity = 5.05;
          const hopSpeed = velocity.length();
          if (hopSpeed > 3.8) velocity.multiplyScalar(Math.min(1.045, 9.35 / hopSpeed));
        }
      }
      const height = crouched ? 1.18 : 1.68;
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, height + jumpHeight + (moving && jumpHeight === 0 ? Math.sin(bob) * 0.035 : 0), dt * 12);
      recoil = THREE.MathUtils.lerp(recoil, 0, dt * 9);
      const reloadRemaining = Math.max(0, reloadingUntil - performance.now() / 1000);
      const reloadPose = reloadRemaining > 0 ? Math.sin((1 - reloadRemaining / currentWeapon().reload) * Math.PI) : 0;
      const inspectElapsed = performance.now() / 1000 - inspectStartedAt;
      const inspectT = inspectDuration > 0 ? clamp(inspectElapsed / inspectDuration, 0, 1) : 1;
      const inspecting = weaponId === "karambit" && inspectT < 1;
      const inspectArc = inspecting ? Math.sin(inspectT * Math.PI) : 0;
      const inspectSpin = inspecting ? (1 - Math.cos(inspectT * Math.PI * 2)) * Math.PI : 0;
      const walkX = moving ? Math.sin(bob * 0.5) * 0.018 : 0;
      const walkY = moving ? Math.abs(Math.sin(bob)) * 0.014 : 0;
      const viewmodelAspect = clamp(camera.aspect / 1.2, 0.52, 1);
      const baseX = (aiming ? 0 : weaponId === "akm" ? 0.35 : weaponId === "karambit" ? 0.26 : 0.31) * viewmodelAspect;
      const baseY = aiming ? -0.285 : weaponId === "karambit" ? -0.04 : -0.3;
      const baseZ = aiming ? (weaponId === "akm" ? -0.45 : -0.43) : weaponId === "akm" ? -0.59 : weaponId === "karambit" ? -0.48 : -0.56;
      gun.position.x = THREE.MathUtils.lerp(gun.position.x, baseX + walkX + viewmodelSwayX - inspectArc * 0.14, dt * 11);
      gun.position.y = THREE.MathUtils.lerp(gun.position.y, baseY + walkY + recoil * 0.38 + viewmodelSwayY - reloadPose * 0.09 + inspectArc * 0.12, dt * 12);
      gun.position.z = THREE.MathUtils.lerp(gun.position.z, baseZ + recoil + reloadPose * 0.08 - inspectArc * 0.08, dt * 12);
      gun.rotation.x = recoil * 1.28 + viewmodelSwayY * 0.75 + reloadPose * 0.48 + inspectArc * 0.62;
      gun.rotation.y = (aiming ? 0 : weaponId === "akm" ? 0.11 : weaponId === "karambit" ? -0.22 : 0.3) + viewmodelSwayX * 0.8 - reloadPose * 0.22 + inspectArc * 0.8;
      gun.rotation.z = -walkX * 0.55 - viewmodelSwayX * 0.6 + reloadPose * 0.86 + inspectSpin;
      camera.rotation.set(pitch, yaw, 0);
      if (firing) fireShot();
    };

    let snapshotAccumulator = 0;
    const publishSnapshot = () => {
      const current = currentWeapon();
      const mag = ammo[current.id] ?? { clip: 0, reserve: 0 };
      const objective = freeForAllMode ? "Free for all · First operator to 30 eliminations" : trainingMode ? "Training range · Four targets respawn automatically" : phase === "buy" ? "Buy phase · Prepare your loadout" : bombPlanted ? `${bombSite} site · Charge armed` : playerTeam === "attack" ? "Plant the charge at A or B" : "Defend both objective sites";
      const visibleBots = bots.filter((bot) => bot.root.visible);
      const playerRows: PlayerRow[] = [
        { name: "YOU", team: playerTeam, kills: playerKills, deaths: playerDeaths, alive: playerAlive, isPlayer: true },
        ...visibleBots.map((bot) => ({ name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, alive: bot.alive })),
      ];
      const leaderKills = Math.max(0, ...bots.map((bot) => bot.kills));
      setSnapshot({
        gameMode,
        phase, team: playerTeam, health: Math.round(playerHealth), armor: Math.round(playerArmor), money: Math.round(playerMoney),
        ammo: mag.clip, reserve: mag.reserve, weapon: current.label, weaponId: current.id, roundTime, phaseTime, attackScore: freeForAllMode ? playerKills : attackScore, defendScore: freeForAllMode ? leaderKills : defendScore,
        round: roundNumber, alive: playerAlive, bombPlanted, bombTime, bombSite, actionText, actionProgress, objective, feed,
        dots: [
          { id: "you", x: camera.position.x, z: camera.position.z, team: playerTeam, alive: playerAlive },
          ...visibleBots.map((bot) => ({ id: bot.id, x: bot.root.position.x, z: bot.root.position.z, team: bot.team, alive: bot.alive })),
        ],
        players: playerRows, roundMessage, hitMarker: performance.now() < hitMarkerUntil, kills: playerKills, deaths: playerDeaths,
        ping: 18 + Math.floor(Math.random() * 9),
        spawnProtected: freeForAllMode && playerAlive && performance.now() / 1000 < playerProtectedUntil,
      });
    };

    const respawnPlayerFreeForAll = () => {
      playerHealth = 100;
      playerArmor = 100;
      playerAlive = true;
      playerDeathTime = 0;
      playerDeathRoll = 0;
      camera.position.copy(nextFfaSpawn()).setY(1.68);
      yaw = Math.random() * Math.PI * 2;
      pitch = 0;
      jumpHeight = 0;
      jumpVelocity = 0;
      velocity.set(0, 0, 0);
      gun.visible = true;
      gun.rotation.set(0, 0, 0);
      playerProtectedUntil = performance.now() / 1000 + 2;
      const akAmmo = ammo.akm;
      if (akAmmo) { akAmmo.clip = WEAPONS.akm.magazine; akAmmo.reserve = WEAPONS.akm.reserve; }
      const pistolAmmo = ammo.v9;
      if (pistolAmmo) { pistolAmmo.clip = WEAPONS.v9.magazine; pistolAmmo.reserve = WEAPONS.v9.reserve; }
      equip(primaryId ?? "akm");
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
          }
        }
      } else if (phase === "live") {
        if (trainingMode) {
          roundTime = 5999;
          return;
        }
        if (freeForAllMode) {
          roundTime -= dt;
          if (!playerAlive && playerDeathTime >= 2.15) respawnPlayerFreeForAll();
          if (roundTime <= 0) {
            const leader = [{ name: "YOU", kills: playerKills }, ...bots.map((bot) => ({ name: bot.name, kills: bot.kills }))].sort((a, b) => b.kills - a.kills)[0];
            finishFreeForAll(leader.name);
          }
          return;
        }
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
      if (document.pointerLockElement !== renderer.domElement || !screenActive || simulationPaused) return;
      const sensitivity = settingsRef.current.sensitivity * 0.0019;
      yaw -= event.movementX * sensitivity;
      pitch = clamp(pitch - event.movementY * sensitivity, -1.34, 1.34);
      viewmodelSwayX = clamp(viewmodelSwayX - event.movementX * 0.00022, -0.032, 0.032);
      viewmodelSwayY = clamp(viewmodelSwayY - event.movementY * 0.00018, -0.026, 0.026);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!screenActive || simulationPaused) return;
      if (document.pointerLockElement !== renderer.domElement) {
        lockPointer();
        audio.resume();
        if (event.button === 0) fireShot();
        if (event.button === 2 && currentWeapon().category !== "melee") aiming = true;
        return;
      }
      if (event.button === 0) { firing = true; fireShot(); }
      if (event.button === 2 && currentWeapon().category !== "melee") aiming = true;
    };
    const onMouseUp = (event: MouseEvent) => { if (event.button === 0) firing = false; if (event.button === 2) aiming = false; };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && screenActive) {
        simulationPaused = true;
        firing = false;
        keys.clear();
        touchKeys.clear();
        setPaused(true);
        return;
      }
      if (simulationPaused) return;
      keys.add(event.code);
      if (event.code === "KeyR") reload();
      if (event.code === "Space" && jumpHeight <= 0.01 && playerAlive) { jumpHeight = 0.002; jumpVelocity = 5.05; }
      if (event.code === "Digit1") equip(primaryId ?? "v9");
      if (event.code === "Digit2") equip("v9");
      if (event.code === "Digit3") equip("karambit");
      if (event.code === "KeyF") inspectKnife();
      if (event.code === "Digit4") trackedThrowGrenade("frag");
      if (event.code === "Digit5") trackedThrowGrenade("smoke");
      if (event.code === "Tab") { event.preventDefault(); setShowScoreboard(true); }
      if (event.code === "KeyB" && phase === "buy") {
        buyOpen = !buyOpen;
        setShowBuy(buyOpen);
        if (buyOpen) {
          intentionalUnlock = true;
          document.exitPointerLock?.();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === "Tab") setShowScoreboard(false);
      if (event.code === "KeyE") actionProgress = 0;
    };
    const onPointerLock = () => {
      if (intentionalUnlock) { intentionalUnlock = false; setPaused(false); return; }
      const shouldPause = screenActive && document.pointerLockElement !== renderer.domElement && phase !== "matchEnd";
      simulationPaused = shouldPause;
      if (shouldPause) {
        firing = false;
        keys.clear();
        touchKeys.clear();
      }
      setPaused(shouldPause);
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
      start: (selectedDifficulty, mode) => {
        screenActive = true;
        simulationPaused = false;
        buyOpen = false;
        setShowBuy(false);
        gameMode = mode;
        trainingMode = mode === "training";
        freeForAllMode = mode === "ffa";
        attackScore = 0;
        defendScore = 0;
        roundNumber = 1;
        playerKills = 0;
        playerDeaths = 0;
        playerMoney = trainingMode ? 16000 : freeForAllMode ? 0 : 3200;
        playerArmor = 0;
        primaryId = freeForAllMode ? "akm" : null;
        weaponId = freeForAllMode ? "akm" : "v9";
        ammo = {
          v9: { clip: WEAPONS.v9.magazine, reserve: WEAPONS.v9.reserve },
          karambit: { clip: 1, reserve: 0 },
          ...(freeForAllMode ? { akm: { clip: WEAPONS.akm.magazine, reserve: WEAPONS.akm.reserve } } : {}),
        };
        bots.forEach((bot) => { bot.kills = 0; bot.deaths = 0; });
        setDifficulty(selectedDifficulty);
        beginRound();
        playerProtectedUntil = freeForAllMode ? performance.now() / 1000 + 2 : 0;
        audio.resume();
      },
      pause: (paused) => {
        simulationPaused = paused;
        if (paused) {
          firing = false;
          keys.clear();
          touchKeys.clear();
        }
      },
      resume: () => { simulationPaused = false; audio.resume(); lockPointer(); },
      stop: () => {
        screenActive = false;
        simulationPaused = true;
        firing = false;
        aiming = false;
        keys.clear();
        touchKeys.clear();
      },
      buy,
      buyArmor,
      setWeapon: (slot) => equip(slot === 1 ? (primaryId ?? "v9") : slot === 2 ? "v9" : "karambit"),
      cycleWeapon: () => equip(weaponId === "karambit" ? (primaryId ?? "v9") : weaponId === "v9" ? "karambit" : "v9"),
      throwGrenade: trackedThrowGrenade,
      setBuyMenu: (open) => {
        buyOpen = open;
        setShowBuy(open);
        if (open) {
          intentionalUnlock = true;
          document.exitPointerLock?.();
        }
      },
      setTouch: (key, down) => {
        if (down) touchKeys.add(key); else touchKeys.delete(key);
        if (down && key === "jump" && jumpHeight <= 0.01 && playerAlive) { jumpHeight = 0.002; jumpVelocity = 5.05; }
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
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.05);
      if (!screenActive || simulationPaused) {
        composer.render(0);
        return;
      }
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
        if (particle.spin) {
          particle.mesh.rotation.x += particle.spin.x * dt;
          particle.mesh.rotation.y += particle.spin.y * dt;
          particle.mesh.rotation.z += particle.spin.z * dt;
        }
        if (particle.life <= 0) { scene.remove(particle.mesh); particles.splice(i, 1); }
      }
      for (let i = tracers.length - 1; i >= 0; i--) {
        const tracer = tracers[i];
        tracer.life -= dt;
        (tracer.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tracer.life / tracer.maxLife) * 0.72;
        if (tracer.life <= 0) { scene.remove(tracer.mesh); tracers.splice(i, 1); }
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
      timer.dispose();
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
      environmentMap?.dispose();
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

  const startGame = useCallback((mode: GameMode = "demolition") => {
    setScreen("game");
    setPaused(false);
    setShowBuy(false);
    setShowSettings(false);
    window.setTimeout(() => engineRef.current?.start(mode === "training" ? "recruit" : difficulty, mode), 0);
  }, [difficulty]);

  const leaveGame = useCallback(() => {
    engineRef.current?.stop();
    setScreen("menu");
    setPaused(false);
    setShowBuy(false);
    setShowScoreboard(false);
    setShowSettings(false);
    document.exitPointerLock?.();
  }, []);

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
  const ffaScoreboard = useMemo(() => [...snapshot.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths), [snapshot.players]);

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
            <div className="brand-lockup"><span className="brand-mark">B</span><span>BREACHLINE</span><small>v1.4 · DUSTLINE</small></div>
            <div className="career-strip"><span>CAREER</span><strong>{stats.wins}W</strong><span>{stats.matches} MATCHES</span><span>{stats.eliminations} ELIMS</span></div>
          </header>
          <div className="menu-content">
            <div className="eyebrow"><span className="live-dot" /> OPERATION 02 · DUSTLINE</div>
            <h1>BREACH<span>LINE</span></h1>
            <p className="menu-subtitle">DESERT COMBAT PROTOCOL</p>
            <p className="menu-copy">Fight through a modern sandstone arena built around long sightlines, central doors, tunnels, and two fortified sites.</p>
            <div className="difficulty" role="group" aria-label="Bot difficulty">
              {(["recruit", "veteran", "elite"] as Difficulty[]).map((value) => (
                <button key={value} className={difficulty === value ? "active" : ""} onClick={() => setDifficulty(value)}>{value}</button>
              ))}
            </div>
            <div className="menu-actions">
              <button className="primary-action" onClick={() => startGame("demolition")}><span>DEMOLITION</span><small>5V5 · DUSTLINE</small></button>
              <button className="ffa-action" onClick={() => startGame("ffa")}><span>FREE FOR ALL</span><small>YOU VS 20 BOTS · FIRST TO 30</small></button>
              <button className="secondary-action" onClick={() => startGame("training")}><span>TRAINING</span><small>Unlimited economy · 4 targets</small></button>
            </div>
            <div className="feature-line"><span>20 AI OPERATIVES</span><i /><span>AKM · 9MM · KARAMBIT</span><i /><span>BUNNY HOP</span><i /><span>LOCAL CAREER</span></div>
          </div>
          <footer className="menu-footer"><span>Original browser tactical FPS · Best with headphones</span><button onClick={() => setShowSettings(true)}>SETTINGS</button></footer>
        </section>
      )}

      {screen === "game" && (
        <section className="game-ui" aria-label="Game HUD">
          <div className="damage-flash" />
          <div className="vignette" />
          <header className="match-header">
            {snapshot.gameMode === "ffa" ? (
              <>
                <div className="team-panel friendly attack"><small>YOU</small><strong>{snapshot.kills}</strong><span>ELIMINATIONS</span></div>
                <div className="round-clock"><span>FREE FOR ALL · FIRST TO 30</span><strong>{formatClock(snapshot.roundTime)}</strong><small>20 BOT ARENA · LIVE</small></div>
                <div className="team-panel enemy defend"><strong>{snapshot.defendScore}</strong><small>BOT LEADER</small><span>{snapshot.players.filter((player) => player.alive).length} ACTIVE</span></div>
              </>
            ) : snapshot.gameMode === "training" ? (
              <>
                <div className="team-panel friendly attack"><small>TRAINING</small><strong>{snapshot.kills}</strong><span>ELIMINATIONS</span></div>
                <div className="round-clock"><span>TRAINING RANGE</span><strong>∞</strong><small>LIVE FIRE DRILL</small></div>
                <div className="team-panel enemy defend"><strong>{snapshot.players.filter((player) => !player.isPlayer && player.alive).length}</strong><small>TARGETS</small><span>AUTO RESPAWN</span></div>
              </>
            ) : (
              <>
                <div className={`team-panel ${snapshot.team === "attack" ? "friendly attack" : "friendly defend"}`}><small>{teamLabel}</small><strong>{scoreLeft}</strong><span>{snapshot.team === "attack" ? aliveAttack : aliveDefend} ALIVE</span></div>
                <div className="round-clock">
                  <span>ROUND {snapshot.round} · FIRST TO 7</span>
                  <strong className={snapshot.bombPlanted ? "danger" : ""}>{snapshot.phase === "buy" ? `BUY ${Math.ceil(snapshot.phaseTime)}` : snapshot.bombPlanted ? formatClock(snapshot.bombTime) : formatClock(snapshot.roundTime)}</strong>
                  <small>{snapshot.bombPlanted ? `CHARGE ARMED · SITE ${snapshot.bombSite}` : snapshot.phase === "buy" ? "PREPARE" : "LIVE"}</small>
                </div>
                <div className={`team-panel ${snapshot.team === "attack" ? "enemy defend" : "enemy attack"}`}><strong>{scoreRight}</strong><small>{snapshot.team === "attack" ? "WARDENS" : "STRIKERS"}</small><span>{snapshot.team === "attack" ? aliveDefend : aliveAttack} ALIVE</span></div>
              </>
            )}
          </header>

          <aside className="minimap" aria-label="Tactical minimap">
            <div className="map-grid" />
            <span className="site site-a">A</span><span className="site site-b">B</span>
            {snapshot.dots.filter((dot) => dot.alive && (snapshot.gameMode === "ffa" || dot.team === snapshot.team || dot.id === "you")).map((dot) => (
              <i key={dot.id} className={`map-dot ${dot.id === "you" ? "you" : dot.team}`} style={{ left: `${((dot.x + 42) / 84) * 100}%`, top: `${((dot.z + 42) / 84) * 100}%` }} />
            ))}
            <label>DUSTLINE</label>
          </aside>

          <div className="objective-chip"><span className={snapshot.bombPlanted ? "pulse" : ""}>{snapshot.bombPlanted ? "◆" : "◇"}</span><div><small>OBJECTIVE</small><strong>{snapshot.objective}</strong></div></div>
          {snapshot.spawnProtected && <div className="spawn-shield"><span>⬡</span> SPAWN PROTECTION</div>}

          <div className="killfeed">{snapshot.feed.map((item) => <div key={item.id}><span>{item.killer}</span><b>{item.weapon}</b><span className={item.friendly ? "friendly-fire" : ""}>{item.victim}</span></div>)}</div>

          <div className={`crosshair ${snapshot.hitMarker ? "hit" : ""}`}><i /><i /><i /><i /><b /></div>

          {snapshot.actionText && <div className="action-progress"><strong>{snapshot.actionText}</strong><div><i style={{ width: `${snapshot.actionProgress * 100}%` }} /></div></div>}
          {snapshot.roundMessage && <div className="round-banner"><small>ROUND COMPLETE</small><strong>{snapshot.roundMessage}</strong></div>}
          {!snapshot.alive && snapshot.phase !== "matchEnd" && <div className="eliminated"><span>ELIMINATED</span><strong>{snapshot.gameMode === "ffa" ? "Respawning in 2 seconds" : "Round continues · Observe the outcome"}</strong></div>}

          <div className="hud-bottom">
            <div className="vitals"><div><small>HEALTH</small><strong>{snapshot.health}</strong><i style={{ width: `${snapshot.health}%` }} /></div><div><small>ARMOR</small><strong>{snapshot.armor}</strong><i style={{ width: `${snapshot.armor}%` }} /></div></div>
            <div className="status-center"><span className={snapshot.gameMode === "ffa" ? "attack" : snapshot.team}>{snapshot.gameMode === "ffa" ? "FREE FOR ALL" : snapshot.gameMode === "training" ? "TRAINING" : teamLabel}</span><strong>{snapshot.gameMode === "ffa" ? `${snapshot.kills}/30` : `$${snapshot.money.toLocaleString()}`}</strong><small>{snapshot.kills} K · {snapshot.deaths} D · {snapshot.ping} MS</small></div>
            <div className="ammo"><small>{snapshot.weapon}</small><div><strong>{snapshot.weaponId === "karambit" ? "—" : snapshot.ammo}</strong><span>{snapshot.weaponId === "karambit" ? "MELEE" : `/ ${snapshot.reserve}`}</span></div><label>1 AKM · 2 PISTOL · 3 KARAMBIT · F INSPECT</label></div>
          </div>

          <button className="hud-menu-button" aria-label="Pause" onClick={() => { engineRef.current?.pause(true); setPaused(true); document.exitPointerLock?.(); }}>Ⅱ</button>
          {snapshot.phase === "buy" && <button className="buy-hint" onClick={() => engineRef.current?.setBuyMenu(true)}><kbd>B</kbd> OPEN BUY MENU</button>}
          {toast && <div className="toast">{toast}</div>}

          <div className="mobile-controls" aria-label="Touch controls">
            <div className="mobile-dpad">
              <button onPointerDown={() => touch("forward", true)} onPointerUp={() => touch("forward", false)} onPointerCancel={() => touch("forward", false)}>▲</button>
              <button onPointerDown={() => touch("left", true)} onPointerUp={() => touch("left", false)} onPointerCancel={() => touch("left", false)}>◀</button>
              <button onPointerDown={() => touch("back", true)} onPointerUp={() => touch("back", false)} onPointerCancel={() => touch("back", false)}>▼</button>
              <button onPointerDown={() => touch("right", true)} onPointerUp={() => touch("right", false)} onPointerCancel={() => touch("right", false)}>▶</button>
            </div>
            <div className="mobile-actions"><button className="mobile-fire" onPointerDown={() => engineRef.current?.setFire(true)} onPointerUp={() => engineRef.current?.setFire(false)} onPointerCancel={() => engineRef.current?.setFire(false)}>FIRE</button><button onPointerDown={() => touch("jump", true)} onPointerUp={() => touch("jump", false)} onPointerCancel={() => touch("jump", false)}>JUMP</button><button onPointerDown={() => touch("interact", true)} onPointerUp={() => touch("interact", false)}>USE</button><button onClick={() => engineRef.current?.cycleWeapon()}>SWAP</button></div>
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
            <header><div><small>{snapshot.gameMode === "ffa" ? "FREE FOR ALL · DUSTLINE" : snapshot.gameMode === "training" ? "TRAINING RANGE · DUSTLINE" : "DEMOLITION · DUSTLINE"}</small><h2>{snapshot.gameMode === "ffa" ? `${snapshot.kills} / 30` : snapshot.gameMode === "training" ? `${snapshot.kills} ELIMS` : <>{snapshot.attackScore} <span>—</span> {snapshot.defendScore}</>}</h2></div><strong>{snapshot.gameMode === "ffa" ? formatClock(snapshot.roundTime) : snapshot.gameMode === "training" ? "SESSION" : `ROUND ${snapshot.round}`}</strong></header>
            {snapshot.gameMode === "ffa" ? (
              <section className="ffa-board"><h3>ARENA RANKING · FIRST TO 30</h3>{ffaScoreboard.map((player, index) => <div key={`ffa-${player.name}`} className={`${player.isPlayer ? "is-player" : ""} ${!player.alive ? "is-dead" : ""}`}><span>{index + 1}</span><strong>{player.name}</strong><span>{player.kills} K</span><span>{player.deaths} D</span><span>{player.alive ? "ACTIVE" : "RESPAWNING"}</span></div>)}</section>
            ) : (["attack", "defend"] as Team[]).map((team) => <section key={team}><h3>{team === "attack" ? "STRIKERS" : "WARDENS"}</h3>{scoreboardGroups[team].map((player) => <div key={`${team}-${player.name}`} className={`${player.isPlayer ? "is-player" : ""} ${!player.alive ? "is-dead" : ""}`}><span className="status-dot" /><strong>{player.name}</strong><span>{player.kills} K</span><span>{player.deaths} D</span><span>{player.alive ? "ACTIVE" : "DOWN"}</span></div>)}</section>)}
          </div>
        </div>
      )}

      {paused && screen === "game" && snapshot.phase !== "matchEnd" && (
        <div className="modal-layer pause-layer" role="dialog" aria-modal="true" aria-label="Pause menu">
          <div className="pause-menu"><small>OPERATION PAUSED</small><h2>BREACHLINE</h2><button className="primary" onClick={() => { setPaused(false); engineRef.current?.resume(); }}>RESUME OPERATION</button><button onClick={() => setShowSettings(true)}>SETTINGS</button><button onClick={toggleFullscreen}>TOGGLE FULLSCREEN</button><button onClick={leaveGame}>LEAVE MATCH</button><p>WASD move · Mouse aim · LMB fire · R reload<br />Hold Space bunny hop · 1/2/3 weapons · F inspect knife · Tab scores</p></div>
        </div>
      )}

      {snapshot.phase === "matchEnd" && screen === "game" && (
        <div className="modal-layer result-layer"><div className="result-card"><small>OPERATION COMPLETE</small><h2>{snapshot.roundMessage}</h2><div><span><b>{snapshot.kills}</b> ELIMINATIONS</span><span><b>{snapshot.deaths}</b> DEATHS</span><span><b>{snapshot.attackScore}—{snapshot.defendScore}</b> FINAL</span></div><button onClick={() => startGame(snapshot.gameMode)}>PLAY AGAIN</button><button onClick={leaveGame}>MAIN MENU</button></div></div>
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
