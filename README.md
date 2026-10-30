# Vinjer Game — Bordeaux Escape

A 3D third-person escape game across four famous Bordeaux places. Use the arrow keys to move along the streets and space to jump, solve clues, and beat the timer.

Play at https://github-conferences-france.github.io/vinjer-game/.

## Deployment

GitHub Actions checks and deploys the repository root to GitHub Pages on every push to `main`. You can also deploy manually with the **Deploy GitHub Pages** workflow. The check allows `index.html` to be absent while the game is being developed; once present, it must not be empty.

## How to play

Start at **Place de la Victoire** and solve a clue at each stop to unlock the next landmark: La Grosse Cloche → Cathédrale Saint-André → Grand Théâtre → Miroir d’eau. You have 5:00.

| Key | Action |
| --- | --- |
| ← → | Turn |
| ↑ ↓ | Walk (streets only) |
| Space | Jump over neon barriers |
| 1 2 3 / Enter | Answer clues / continue (wrong answer: −15 s) |
| + − / wheel | Zoom camera |
| P / Esc, R | Pause, restart |

Pick a pace on the title screen: Stroll 11 m/s (hard), Jog 14 m/s (normal), Run 17 m/s (relaxed).

## Development

No build, no server, no dependencies: open `index.html` directly. `js/world.js` holds the map and physics (DOM-free), `js/game.js` the Canvas 2D 3D renderer, HUD and minimap.

```sh
node --test tests/*.test.js   # map sanity, physics, autopilot feasibility per pace
```
