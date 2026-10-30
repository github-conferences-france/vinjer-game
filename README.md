# Vinjer Game — Bordeaux Escape

A 3D third-person escape game across four famous Bordeaux places. Use the arrow keys to move along the streets and space to jump, solve clues, and beat the timer.

Play at https://github-conferences-france.github.io/vinjer-game/.

## Deployment

GitHub Actions checks and deploys the repository root to GitHub Pages on every push to `main`. You can also deploy manually with the **Deploy GitHub Pages** workflow. The check allows `index.html` to be absent while the game is being developed; once present, it must not be empty.
