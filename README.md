# Lia's Phoenix Jewels

A gentle browser game for Lia: fly as a phoenix, ride a unicorn, collect magic gems and craft enchanted jewelry.

Play it at https://eternityslyre.github.io/HoofHornAndPhoenixDown/ once GitHub Pages is on (Settings → Pages → Deploy from branch `main`, folder `/ (root)`).

The whole game is the single `index.html` file. No build step and no install. Progress is saved in the player's own browser.

## The games hub (on this computer's server)

Double-click `start-server.bat` (or run `npm install` once, then `npm start`). `http://localhost:8080/` is **Lia's Games**, a page with a card for every game in `games.json`. Each game lives at `/games/<name>/`.

- **Phoenix Jewels** is `index.html` in this folder. Everyone playing it who picks the same land sees each other's unicorn and phoenix.
- **Emilia's Super Speedy Hide and Seek** comes from [eternityslyre/liakratts](https://github.com/eternityslyre/liakratts). Clone it into a `liakratts` folder here (this repo ignores it).
- **New games** that Claude makes go in `games/<name>/` and are added to `games.json`.

**Changes and new games:** every page has a ✨ button on the left edge (and inside a game, a button back to the games page). Enter the host password, choose **Change this game** or **Make a new game**, and type what you'd like. Claude Code does the work on this computer. Only the people playing a changed game see it reload, a new game appears on the games page by itself when it's ready, and requests for different games run at the same time. `/host` shows the same chat as its own page. The password lives in `server/password.txt` (not in git) or the `HOST_PASSWORD` environment variable; without either, the server makes one up and prints it.

The chat uses the Claude Code CLI on this computer, so it needs to be signed in once (run `claude` in a terminal and type `/login`). The server finds the copy that comes with the Claude desktop app; set `CLAUDE_BIN` if it lives somewhere else and `PORT` to change the port.

Players on other computers in the same Wi-Fi can use `http://<this-computer's-IP>:8080/`. Players elsewhere can join at **https://emilia.eternityslyre.com**: double-click `start-with-tunnel.bat`, which starts the server and the Cloudflare named tunnel `emilia-game` (set up on this PC with `cloudflared tunnel login`). On a computer without that tunnel it falls back to a temporary https://…trycloudflare.com link. The games are only reachable while the window is open.

The GitHub Pages copy of Phoenix Jewels still works as a single-player game; multiplayer, live reload and the chat only switch on when it's served by this server.
