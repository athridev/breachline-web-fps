# Breachline: Demolition Protocol

An original, full-screen tactical first-person shooter that runs entirely in the browser. Breachline combines classic one-life demolition rounds with a modern 3D presentation and no external game server.

## Play

- **WASD** move, **mouse** aim, **left click** fire
- **Shift** sprint, **Ctrl** crouch, **R** reload
- **E** plant or defuse, **B** buy menu, **Tab** scoreboard
- **1/2** switch weapons, **4/5** throw frag or smoke

The game includes a 5v5 bot match, side swap, first-to-seven scoring, an AKM rifle and 9mm pistol, economy and armor, two bomb sites, grenades, minimap, kill feed, configurable difficulty, audio, touch controls, training mode, and locally saved career stats. Weapon handling includes an articulated two-hand viewmodel, sway, recoil, reload motion, muzzle flash, tracers, and ejected casings. Eliminated players remain in the arena with animated directional falls instead of disappearing.

## Visual assets

The first-person AKM and pistol use high-detail CC0 geometry by Lamoot and locarem. Quaternius' lightweight CC0 Ultimate Guns models remain in use for bots and fallbacks, while the industrial sunset environment map comes from Poly Haven. Original generated concrete and promotional art are documented in [`GENERATED_ASSETS.md`](./GENERATED_ASSETS.md). Full third-party source and license details are recorded in [`THIRD_PARTY_ASSETS.md`](./THIRD_PARTY_ASSETS.md).

## Develop

```bash
npm install
npm run dev
```

Production checks:

```bash
npm test
npm run build:pages
```

## Original work

Breachline is an original browser game. It is not affiliated with, endorsed by, or derived from Valve or Counter-Strike. No Counter-Strike code, maps, models, sounds, logos, or other proprietary assets are included.
