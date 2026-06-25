# Putting BRIDGE online (so testers just click a link)

This gets the game hosted on the internet for **free**, with **no installing
Node, no terminals**. You do it once; afterward you have a web link you send to
playtesters. They just open it and play.

It works because the whole game has been bundled into **one service** (the
backend, the game server, and the client all run together on one address).

You'll use two free websites: **GitHub** (to store the code) and **Render** (to
run it). Total time: about 15–20 minutes the first time.

---

## Part 1 — Put the code on GitHub

GitHub holds your code so Render can read it.

1. Make a free account at <https://github.com> if you don't have one.
2. Click the **+** in the top-right → **New repository**.
3. Name it `bridge-game` (anything is fine). Leave it **Public**. Click
   **Create repository**.
4. On the next page, click the link **“uploading an existing file”**
   (in the "…or push an existing repository" area there's also a
   **“Upload files”** option — either works).
5. **Unzip the bundle I gave you** (`bridge-game.zip`) on your computer first.
   Then drag the unzipped folder's **contents** into the upload box — that means
   the `bridge-backend`, `bridge-client`, `bridge-gameserver`, `bridge-deploy`
   folders plus the files like `render.yaml`, `RUN.md`, `.gitignore`. (Drag the
   folders themselves, not a single zip.)
   - GitHub's web uploader accepts folders by drag-and-drop. If it struggles with
     many files at once, upload a few folders, commit, then upload the rest.
6. Scroll down, click **Commit changes**.

You now have all the code on GitHub. Keep this browser tab open.

> Tip: make sure `render.yaml` ended up in the **top level** of the repo (not
> inside a subfolder). Render looks for it there.

---

## Part 2 — Deploy on Render

1. Make a free account at <https://render.com>. Sign up **with GitHub** (the
   button is right there) — it links the two automatically. **No credit card.**
2. In the Render dashboard, click **New +** (top right) → **Blueprint**.
3. Render shows your GitHub repositories. Pick **bridge-game**.
   - If it asks to install/authorize Render on GitHub, click through and allow it
     (you can grant access to just this one repo).
4. Render reads the included `render.yaml` and shows a service named
   **bridge-game** on the **Free** plan. Click **Apply** (or **Create**).
5. It starts building. This takes a few minutes the first time — you'll see a log
   scrolling. When it finishes you'll see **Live** and a URL like
   `https://bridge-game-xxxx.onrender.com`.

That URL **is your game.** Open it in a browser to check, then send it to testers.

---

## Part 3 — Playtesters

Send them the link. They open it, type a name to sign in, and play. To get a
match going they either:
- **Add bots** in the lobby (host clicks "Add a Bot"), or
- have a few people open the same link and join the same room code.

Nothing to install on their end.

---

## Good things to know

- **Free tier "sleeps."** After ~15 minutes with nobody on it, Render pauses the
  service to save resources. The next person to open the link waits about a
  minute while it wakes up, then it's normal. Totally fine for playtests. (Paid
  plans, ~$7/mo, remove the sleep if you ever want always-on.)
- **Updating the game later.** When I give you new code, replace the files in your
  GitHub repo (drag-and-drop, commit). Render notices and re-deploys automatically
  — you don't touch Render again.
- **Data resets.** Accounts/progress live in memory and reset when the service
  sleeps or redeploys. That's expected for now; a permanent database (Postgres) is
  a later step if you want progress to stick.
- **Sign-in & payments** remain in dev/test mode (stubbed Google, Stripe test
  mode). Real keys are a later step and don't block playtesting.

---

## If something goes wrong

- **Build failed in Render's log.** Copy the red error text and send it to me —
  it's almost always a small fix.
- **Page loads but says it can't connect / blank.** Give it a minute (it may be
  waking from sleep), then refresh. If it persists, send me the URL and what you
  see.
- **GitHub upload won't take the folders.** Upload one folder at a time, clicking
  **Commit changes** after each. Make sure `render.yaml` is at the top level.

You don't need to understand any of the code to do this — just the click steps
above. If you get stuck on any single step, tell me which step number and what
you see, and I'll walk you through it.
