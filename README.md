# Lia's Phoenix Jewels

A gentle browser game for Lia: fly as a phoenix, ride a unicorn, collect magic gems and craft enchanted jewelry.

Play it at https://eternityslyre.github.io/HoofHornAndPhoenixDown/ once GitHub Pages is on (Settings → Pages → Deploy from branch `main`, folder `/ (root)`).

The whole game is the single `index.html` file. No build step and no install. Progress is saved in the player's own browser.

## Playing together on one computer's server

Double-click `start-server.bat` (or run `npm install` once, then `npm start`). It prints two links:

- **Play** (`http://localhost:8080/`): open it in any browser. Everyone who opens it and picks the same land sees each other's unicorn and phoenix, with the unicorn's name above them. Gems and progress stay separate for each player.
- **Host** (`http://localhost:8080/host?key=…`): keep this one private. Type a change ("make the gems bigger", "add a rainbow in the lake") and Claude Code edits `index.html`. When it finishes, every open game reloads by itself.

The host page uses the Claude Code CLI on this computer, so it needs to be signed in once (run `claude` in a terminal and type `/login`). Set `CLAUDE_BIN` if it lives somewhere unusual, `PORT` to change the port, and `HOST_KEY` to keep the same host link between restarts.

Players on other computers in the same Wi-Fi can use `http://<this-computer's-IP>:8080/`. Players elsewhere can join at **https://emilia.eternityslyre.com**: double-click `start-with-tunnel.bat`, which starts the server and the Cloudflare named tunnel `emilia-game` (set up on this PC with `cloudflared tunnel login`). On a computer without that tunnel it falls back to a temporary https://…trycloudflare.com link. The game is only reachable while the window is open.

The GitHub Pages copy still works as a single-player game; multiplayer and live reload only switch on when the game is served by this server.
