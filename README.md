# Breachline: Dustline Protocol

An original, full-screen tactical first-person shooter that runs entirely in the browser. Breachline combines one-life demolition rounds, a 20-bot free-for-all arena, and a modern 3D presentation with no external game server.

## Play

- **WASD** move, **mouse** aim, **left click** fire
- **Shift** sprint, **Ctrl** crouch, **Space** jump/bunny hop, **R** reload
- **E** plant or defuse, **B** buy menu, **Tab** scoreboard
- **1/2/3** switch AKM, pistol, or karambit; **F** inspects/flips the karambit
- **4/5** throw frag or smoke

The game includes 5v5 demolition, a first-to-30 free-for-all against 20 active bots, training mode, side swap, an AKM rifle, 9mm pistol, and procedural karambit, economy and armor, two bomb sites, grenades, minimap, kill feed, configurable difficulty, audio, touch controls, and locally saved career stats. Weapon-only viewmodels include sway, recoil, reload motion, muzzle flash, tracers, ejected casings, melee attacks, and a full karambit inspection flip. Eliminated players collapse directionally and remain visible until their mode respawns or resets them.

## Visual assets

The first-person AKM and pistol use high-detail CC0 geometry by Lamoot and locarem. Quaternius' lightweight CC0 Ultimate Guns models remain in use for bots and fallbacks. Dustline uses CC0 sandstone wall and ground materials plus environmental lighting from Poly Haven. Original generated promotional art is documented in [`GENERATED_ASSETS.md`](./GENERATED_ASSETS.md). Full third-party source and license details are recorded in [`THIRD_PARTY_ASSETS.md`](./THIRD_PARTY_ASSETS.md).

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
