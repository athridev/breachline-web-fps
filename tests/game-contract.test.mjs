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
  assert.match(source, /new THREE\.ExtrudeGeometry\(bladeShape/);
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
