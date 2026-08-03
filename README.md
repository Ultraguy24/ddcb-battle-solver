# DDCB Battle Solver

🚧 **Status: in testing.** Rules and card data are still being verified against real matches — expect bugs and gaps.

A companion tool for *Digimon Digital Card Battle* (PS1). Tracks a live duel turn-by-turn (draw, entrance, DP/digivolve, attack) and recommends plays — best attack, best support card, and whether to sacrifice or digivolve — based on the actual card data and a worst-case (maximin) solver.

## Files

- `index.html` — page structure
- `style.css` — styling
- `app.js` — all game logic (card loading, solver math, battle flow, card database UI)
- `cards.json` — the card database (Digimon + Option cards). Edit this directly to fix data, add missing cards, or reorder to match the in-game list.

## Running it

Just open `index.html` in a browser. If you're using Chrome or Edge and opened the file directly (`file://`), it may block `cards.json` from loading due to local-file CORS restrictions — you'll see a red error banner if so. Fixes:

- Use Firefox, which allows this by default, **or**
- Serve it locally:
  ```
  python3 -m http.server 8000
  ```
  then visit `http://localhost:8000/index.html`

## Known limitations

- Some card effects (discards, HP swaps, specialty swaps, "jamming," ordering "counter" effects) are shown as text only and not yet auto-applied by the solver.
- Card data was transcribed from a community FAQ and hasn't been fully verified against the cartridge — corrections welcome via `cards.json`.
- No persistence between sessions yet beyond your own card-database edits.
