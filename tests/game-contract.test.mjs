import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const gamePath = new URL("../app/BreachlineGame.tsx", import.meta.url);
const source = await readFile(gamePath, "utf8");

test("ships all requested combat modes and weapon controls", () => {
  assert.match(source, /FREE FOR ALL/);
  assert.match(source, /YOU VS 20 BOTS/);
  assert.match(source, /Karambit Knife/);
  assert.match(source, /event\.code === "Digit3"/);
  assert.match(source, /event\.code === "KeyF"/);
  assert.match(source, /cycleWeapon/);
  assert.match(source, />JUMP<\/button>/);
});

test("keeps the first-person presentation weapon-only and correctly oriented", () => {
  assert.doesNotMatch(source, /makeHand|rightGrip|leftGrip/);
  assert.match(source, /object\.rotation\.x = Math\.PI \/ 2/);
  assert.match(source, /models\/joshas\/karambit\.glb/);
  assert.match(source, /new GLTFLoader\(\)\.load\(karambitUrl/);
});

test("uses textured masked tactical soldiers with a safe fallback", () => {
  assert.match(source, /models\/joshas\/elite-soldier\.glb/);
  assert.match(source, /soldierTemplate\.clone\(true\)/);
  assert.match(source, /fallbackBody\.visible = false/);
  assert.match(source, /soldierCosmetic/);
});

test("keeps the skyline clean and uses weapon-specific combat audio", () => {
  assert.doesNotMatch(source, /new THREE\.ConeGeometry\(8 \+ \(i % 4\)/);
  assert.match(source, /sound\(weapon\.id === "akm" \? "akmShot" : "pistolShot"\)/);
  assert.match(source, /sound\(isHeadshot \? "headshot" : "hit"\)/);
  assert.match(source, /playNoise\("highpass", 2700/);
  assert.match(source, /playTone\("sine", 1880, 940/);
});

test("marks enemy tactical vests red in team modes and free for all", () => {
  assert.match(source, /const isEnemy = freeForAllMode \|\| bot\.team !== playerTeam/);
  assert.match(source, /isEnemy \? 0xc63d35 : 0x416a73/);
  assert.match(source, /child\.userData\.vest = name === "vest"/);
  assert.match(source, /const vestPlate = new THREE\.Mesh/);
  assert.match(source, /const vestBack = vestPlate\.clone\(\)/);
  assert.match(source, /child\.userData\.part = child\.userData\.vest \? "body" : "head"/);
  assert.match(source, /updateBotVest\(bot\)/);
});

test("free-for-all remains fair and training remains reusable", () => {
  const names = source.match(/const BOT_NAMES = \[(.*?)\];/s)?.[1].match(/"[A-Z]+"/g) ?? [];
  assert.equal(names.length, 20);
  assert.match(source, /playerProtectedUntil = performance\.now\(\) \/ 1000 \+ 2/);
  assert.match(source, /spawnProtected:/);
  assert.match(source, /Four targets respawn automatically/);
  assert.match(source, /else if \(trainingMode\) bot\.respawnAt/);
});

test("pause and leave stop gameplay simulation", () => {
  assert.match(source, /simulationPaused = paused/);
  assert.match(source, /if \(!screenActive \|\| simulationPaused\)/);
  assert.match(source, /stop: \(\) =>/);
  assert.match(source, /engineRef\.current\?\.stop\(\)/);
});

test("bundles the licensed sandstone material set", async () => {
  const assets = [
    "old_sandstone_02_diff_1k.jpg",
    "old_sandstone_02_nor_gl_1k.jpg",
    "old_sandstone_02_rough_1k.jpg",
    "red_sandstone_pavement_diff_1k.jpg",
    "red_sandstone_pavement_nor_gl_1k.jpg",
    "red_sandstone_pavement_rough_1k.jpg",
  ];
  for (const asset of assets) {
    const info = await stat(new URL(`../public/textures/polyhaven/${asset}`, import.meta.url));
    assert.ok(info.size > 100_000, `${asset} should contain a production texture`);
  }
});

test("bundles the attributed FPS karambit model", async () => {
  const model = await stat(new URL("../public/models/joshas/karambit.glb", import.meta.url));
  const soldier = await stat(new URL("../public/models/joshas/elite-soldier.glb", import.meta.url));
  const license = await readFile(new URL("../public/models/joshas/LICENSE.txt", import.meta.url), "utf8");
  assert.ok(model.size > 25_000, "karambit should contain the full converted mesh");
  assert.ok(soldier.size > 700_000, "soldier should contain its complete textured mesh");
  assert.match(license, /JoshAS/);
  assert.match(license, /hackcraft\.de/);
  assert.match(license, /LeeZH/);
  assert.match(license, /CC BY 3\.0/);
});
