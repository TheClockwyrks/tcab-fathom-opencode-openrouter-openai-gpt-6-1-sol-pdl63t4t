# Fathom — Kindle

**Hunt in the dark.** A bioluminescent deep-sea maze chase, played entirely in
your browser. Graze every plankton mote to descend. Eating makes your light
brighter and your circular view wider, but it also draws the hunters closer.

Terrain stays remembered after your light leaves it. Only the ground inside
your growing vision circle remains visible; sonar and enemy flares can reach
further into the black. An amber glimmer might be a harmless drifter, or a
Lanternjaw wearing its disguise. The eyeless Gloamfin hears your sonar and sends
its own pings. The Flarefish hunts in sudden flashes through the rock.

## Run locally

Use a current Node.js version supported by Vite (Node 22.12+ or Node 24+).

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. All art is included; no external service,
downloaded font, account, or API key is used.

## Build and serve

```sh
npm ci
npm run build
npm run preview
```

The complete static site is emitted to **`dist/`**, with `index.html` at its
root. Deploy that directory as-is to a static host. Page-relative asset URLs
support both root deployment and deployment under a sub-path. `npm run preview`
serves the production build locally on port 4173.

## Controls

| Control | Action |
| --- | --- |
| Arrow keys / WASD | Swim; release to stop. Buffer turns before a junction. |
| Space | Send sonar through the corridors. It reveals terrain and can give your position away. |
| Either Shift | Leave a stationary ink cloud to blind light-hunters. |
| Escape / P | Pause or resume. |
| M | Toggle sound on any screen. |
| Up / Down | Select a menu item. |
| Enter / Space | Confirm a menu selection. |
| Escape | Go back from the field guide or game-over screen. |
| Backtick | Toggle the read-only diagnostic overlay. |

Menus also support mouse, pen, and touch. On a touchscreen, the engine displays a
direction pad and action buttons: **A** is sonar and **B** is ink.

Your three reserve lives are additional attempts. Clearing a maze earns 500
points, each plankton 10, and each harmless drifter 200. Deeper dives add hunters
and shorten sonar range.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests use Vitest, the actual Simple 2D engine, a counted simulation clock, and a
Node canvas with the supplied art. They cover maze topology, continuous travel,
uneven frame timing, fog and the circular blackout, sonar propagation, ink,
the three predator minds, den releases, menus, drifters, lives, and scoring.
Coverage and the JSON test report are written to `coverage/`.

## Source map

- `src/game.ts`: engine registration, asset loading, and fixed-step integration.
- `src/types.ts`: complete value-state and debug API contracts, re-exported by `game.ts`.
- `src/maze.ts`: layout, grid travel, shortest paths, and line of sight.
- `src/simulation.ts`: sensing, predator minds, sonar, contact, and grazing.
- `src/world.ts`: state construction, derived readings, resets, and progression.
- `src/debug.ts`: validated, immutable scenario poses and JSON snapshots.
- `src/menus.ts`: keyboard and pointer menu interactions.
- `src/presentation.ts`: canvas screens, sprite animation, fog, effects, and HUD.
- `src/stage.css`: preserves the page's full-window canvas layout across resizes.
- `showcase/`: player-facing description, screenshots, and a recorded live dive.

The engine owns the loop, input, audio, loading, canvas fit, and debug overlay.
Every transition returns a new state; simulation never reads the renderer or a
wall clock. Automation reaches the returned debug surface through an engine
handle, without publishing anything on the page:

```ts
await engine.initialize();
engine.apply((s) => engine.debug.setScreen(s, "playing"));
engine.apply((s) => engine.debug.setBrightness(s, 1));
await engine.advance(120);
const snapshot = engine.debug.snapshot(engine.state);
```

See `specs/` for the dive's full contract and `engine/` for the runtime API.
