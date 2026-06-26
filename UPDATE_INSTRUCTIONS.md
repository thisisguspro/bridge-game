# BRIDGE — Update Your Game (Full Source Replace)

This bundle has the **complete current source** for everything built so far. Use
it to update your GitHub repo in one shot instead of copying files one by one.

## What's inside

```
bridge-client/src        ← all client code
bridge-client/public     ← asset folders (rooms/ and sounds/ with READMEs)
bridge-gameserver/src    ← all game-server code
bridge-backend/src       ← all backend code
```

That's it — just the `src` folders (and the client's `public`). Nothing else
changed this round.

## How to update (GitHub Desktop)

Your repo lives at `Documents\GitHub\bridge-game`.

1. **Unzip this bundle** somewhere temporary (e.g. your Desktop).
2. Copy these folders **into your repo, replacing the existing ones**:
   - `bridge-client\src`  → replace `Documents\GitHub\bridge-game\bridge-client\src`
   - `bridge-client\public` → **merge** into `...\bridge-client\public`
     (say "replace" if Windows asks — it only updates the README/folders, and
     keeps any art/sound files you've already added)
   - `bridge-gameserver\src` → replace `...\bridge-gameserver\src`
   - `bridge-backend\src` → replace `...\bridge-backend\src`
3. **DO NOT touch** anything else in the repo — leave `node_modules`, `.git`,
   `package.json`, `render.yaml`, the `.github` folder, etc. exactly as they are.
4. Open **GitHub Desktop**. It'll show all the changed files. Type a summary
   like `update: ship gen, attack, airlock, helm, collision, accessibility,
   emotes` and click **Commit to main**, then **Push origin**.
5. **Render redeploys automatically.** Give it ~2–4 minutes, then hard-refresh
   the game (Ctrl+Shift+R).

## Safe to delete-and-replace?

Replacing the **`src` folders** wholesale is safe — they contain only code, no
git or dependency data. Just don't delete the *whole* package folders (that would
remove `node_modules` and break the build) — only their `src` (and merge
`public`).

## Optional art/sound (whenever your artist delivers)

- Room art PNGs → `bridge-client\public\assets\rooms\` (named `helm.png`, etc.)
- Sound effects → `bridge-client\public\assets\sounds\` (named `emote_laugh.mp3`,
  etc.)

Both are optional — the game falls back to drawn floors and silence if they're
missing, so you can add them any time and redeploy.

## What changed this whole effort (so your commit note can reference it)

Same-room visibility · Play-first menu · menu hidden in match · new 15-room ship
generator (Helm/Reactor dead-ends, scaling rooms, turrets ≥2× impostors, airlock)
· task tracker · Esc menu + surrender · voting moved to V / top-right · HUD
declutter + bigger tips · lobby buttons pinned · turret + 20-plane attack system
(random + callable, own cooldown) · airlock (tether, faster O₂, solder, impostor
lock, bang-for-help, freeze death) · Helm engines↔shields allocation slider (5s
slow / 15s speed ramp, 10s attack warning, ramp perks) · furniture collision ·
room-art image rendering with fallback + artist templates · colorblind symbols +
full accessibility menu · Terms of Service on first signup · PG-13 name filter
(→ Child#########) · streamer mode + decoy-code troll screen · anime emotes +
sound-cue system + walk cycle. Engine: 170 tests passing.
