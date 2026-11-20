# Village League TV

A small live-match app: viewer page, admin dashboard, and a tiny server. No packages to install, only Node.js.

## Run it

```
ADMIN_PASSWORD=choose-a-password node server.js
```

(On Windows PowerShell: `$env:ADMIN_PASSWORD="choose-a-password"; node server.js`)

- Viewers: http://localhost:3000/
- Admin:   http://localhost:3000/admin

To show it on phones, connect them to the same Wi-Fi and open `http://<your-computer-IP>:3000/`.
To put it online, deploy the folder to any Node host (Render, Railway, a VPS) and set `ADMIN_PASSWORD`.

## How the "link keeps changing" problem is handled

1. **Admin updates the link once.** In the dashboard, paste the new link into the match card and press *Update link*.
   Every viewer's player checks for changes every 4 seconds and switches to the new link by itself, with no refresh.
2. **Backup links.** Add up to 3 links per match. After 3 failed reconnects on one link, the player moves to the next.
3. **Self-healing player.** It reconnects with backoff when the network drops, restarts if the picture freezes for 12 seconds,
   and reconnects immediately when the phone's internet returns.

## Where your stream comes from

Use a source you control or are allowed to use, for example:
- Stream the village match from a phone or laptop with OBS / Larix to a streaming service that gives you an **.m3u8 (HLS)** link, or
- Use a YouTube / Facebook live embed link and choose **Embed page** as the type.

The HLS server must allow cross-origin playback (CORS). Most streaming services do.
A public test stream is preloaded so you can demo the reconnect behaviour.

## Commentary

Add commentary streams in the dashboard (label plus an https audio stream URL). Viewers pick one from the 🎙 menu.
The video is muted and the commentary plays instead. The **Sync delay** slider holds the audio back so it lines up with the picture.
If the station's stream does not allow CORS, it still plays but the delay slider is unavailable.

An FM frequency (89.2) cannot be received by a website. The station must publish an internet stream, or you can relay
one commentator through a service like Icecast / a phone streaming app.

## Files

- `server.js` – API and storage (`data.json` is created automatically)
- `index.html` – viewer page and player
- `admin.html` – dashboard (pin matches, go live, update links, manage commentary)
