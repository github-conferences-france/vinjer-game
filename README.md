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
| Shift | Sprint (×1.5) — hitting anything makes you stumble: half speed for 2 s |
| Space | Jump over pink barriers |
| 1 2 3 / Enter | Answer clues / continue (wrong answer: −15 s) |
| + − / wheel | Zoom camera |
| P / Esc, R | Pause, restart |

Pick a pace on the title screen: Stroll 11 m/s (hard), Jog 14 m/s (normal), Run 17 m/s (relaxed).

Obstacles: pink barriers can be jumped; orange roadworks block half the street and must be walked around; lime trams run on Cours d’Alsace-Lorraine and the quays and knock you aside. Every hit slows you down.

## Photo credits

Landmark photos come from Wikimedia Commons, resized:

- Place de la Victoire — [Fran Roy](https://commons.wikimedia.org/wiki/File:Porte_d%27Aquitaine_et_rue_Sainte-Catherine_au_fond.jpg), CC BY-SA 4.0
- La Grosse Cloche — [Grand Parc Bordeaux](https://commons.wikimedia.org/wiki/File:Bordeaux_-_La_Grosse_Cloche-cr.jpg), CC BY 2.0
- Cathédrale Saint-André — [Chabe01](https://commons.wikimedia.org/wiki/File:Cath%C3%A9drale_St_Andr%C3%A9_Bordeaux_3.jpg), CC BY-SA 4.0
- Grand Théâtre — [Monster1000](https://commons.wikimedia.org/wiki/File:GrandTheatreBordeaux2.jpg), CC BY-SA 3.0
- Miroir d’eau — [Olivier Aumage](https://commons.wikimedia.org/wiki/File:Bordeaux_Miroir_001.jpg), CC BY-SA 2.5

## Development

No build, no server, no dependencies: open `index.html` directly. `js/world.js` holds the map and physics (DOM-free), `js/game.js` the Canvas 2D 3D renderer, HUD and minimap.

```sh
node --test tests/*.test.js   # map sanity, physics, autopilot feasibility per pace
```
