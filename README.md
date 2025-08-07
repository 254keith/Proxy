# ███╗░░██╗███████╗██╗░░░██╗██╗░██████╗░████████╗

# ████╗░██║██╔════╝██║░░░██║██║██╔════╝░╚══██╔══╝

# ██╔██╗██║█████╗░░╚██╗░██╔╝██║██║░░██╗░░░░██║░░░

# ██║╚████║██╔══╝░░░╚████╔╝░██║██║░░╚██╗░░░██║░░░

# ██║░╚███║███████╗░░╚██╔╝░░██║╚██████╔╝░░░██║░░░

# ╚═╝░░╚══╝╚══════╝░░░╚═╝░░░╚═╝░╚═════╝░░░░╚═╝░░░

---

# Ultimate Proxy — Fabulous README

*A polished, full-featured README for your proxy project — designed to be copy/paste-ready and absolutely fabulous.*

> **Purpose:** This README documents how to run, develop, and deploy the Ultimate Proxy — a Node.js/Express proxy that handles JSON APIs, HLS (.m3u8) streaming, Cloudflare/JS-challenge pages (via Puppeteer), caching, header rewriting, and an admin UI.

---

## Table of Contents

1. Quick Start
2. Features
3. Project Structure
4. Install & Run
5. Environment Variables
6. How the Proxy Works (internals)
7. HLS / .m3u8 Handling (playlist rewriting + chunk proxying)
8. Frontend Integration (HLS.js example)
9. Deployment Tips (free + always-on options)
10. Troubleshooting & Debugging
11. Security & Legal
12. Credits & License

---

## 1 — Quick Start

**Clone, install, run:**

```bash
git clone <your-repo-url> ultimate-proxy
cd ultimate-proxy
npm install
node app.js
```

Open your browser to `http://localhost:3002/` (or set `PORT` env var).

Use the proxy like:

```
http://localhost:3002/proxy?url=https://example.com/api/data.json
http://localhost:3002/proxy?url=https://cdn.example.com/movie/master.m3u8
```

---

## 2 — Features

* ✅ JSON API proxying (axios)
* ✅ HLS playlist (.m3u8) rewriting and chunk proxying
* ✅ Video streaming with `Range` support
* ✅ Puppeteer fallback for JS-rendered / Cloudflare-protected pages
* ✅ Header rewriting middleware
* ✅ In-memory caching (node-cache)
* ✅ File logging (winston) + console logs (morgan)
* ✅ Admin dashboard (cached keys + recent logs)
* ✅ Rate limiting to prevent abuse

---

## 3 — Project Structure

```
proxy-project/
├── app.js                 # Main Express app (proxy routes, logging, cache, admin)
├── package.json
├── views/
│   ├── index.ejs          # Home / form
│   └── admin.ejs          # Admin dashboard
├── public/                # optional static (css/js)
├── proxy/
│   └── puppeteerHandler.js# Puppeteer renderer + helper fetch logic
└── logs/                  # winston log output
```

---

## 4 — Install & Run (detailed)

**Install (one-by-one to avoid EBUSY issues on Windows):**

```bash
npm install express
npm install axios
npm install morgan
npm install ejs
npm install node-cache
npm install puppeteer-core
npm install winston
```

If `puppeteer-core` installation is problematic on Windows, either install `puppeteer` (bundled Chromium) or set `CHROME_PATH` environment variable to your Chrome/Chromium executable and use `puppeteer-core`.

**Start**

```bash
PORT=3002 node app.js
```

---

## 5 — Environment Variables

You can set the following environment variables (via `.env`, system env, or your host's dashboard):

* `PORT` — port to listen on (default `3002`)
* `CACHE_TTL` — seconds to cache HTML/JSON responses (default `300`)
* `CHROME_PATH` — path to Chrome/Chromium binary (if using `puppeteer-core`)
* `NODE_ENV` — `production` | `development`

---

## 6 — How the Proxy Works (internals)

1. The `/proxy` route accepts a `url` query param. It validates and decodes it.
2. For API/JSON URLs (detected by `Content-Type` or `url` pattern), the server uses `axios` to fetch JSON, then returns or renders it. If JSON holds a `streamingLink`, the server renders a small HTML page with a video player that points back at the proxy.
3. For `.m3u8` playlists and media files, the server proxies the playlist and rewrites all segment URLs so the player requests go through the same proxy (avoids CORS and referer checks). The proxy streams segment chunks and supports `Range` headers.
4. For HTML pages that require JS (Cloudflare checks, SPA content), `puppeteer` is used to render the page and return the fully hydrated HTML.
5. Caching is applied for JSON and HTML responses to speed up repeat requests; streams are proxied live and not cached in memory.

---

## 7 — HLS (.m3u8) Handling — How to Proxy Properly

To play an `.m3u8` through the browser you need:

* A player library in the frontend (e.g. `hls.js`) to load HLS in browsers that don't support it natively.
* A proxy that does two things:

  1. **Serve the `.m3u8`**: fetch the playlist from upstream, rewrite segment URIs to your proxy endpoint, and return the modified playlist.
  2. **Proxy segment requests**: when the player requests `segmentX.ts` (via the rewritten URL) your server fetches it from upstream and streams it back to the client, including `Content-Type`, `Content-Length`, `Accept-Ranges`, and `Content-Range` if present.

**Playlist rewriting example**

```js
// client requests:
// /proxy?url=https://cdn.example.com/video/master.m3u8

// server fetches the master.m3u8 and rewrites lines like:
// https://cdn.example.com/video/seg1.ts
// =>
// /proxy?url=https://cdn.example.com/video/seg1.ts
```

**Important**: keep the same `Range` and other headers when proxying segment requests so seeking works.

---

## 8 — Frontend Integration (HLS.js example)

**Vanilla HTML + hls.js**

```html
<!doctype html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
  </head>
  <body>
    <video id="video" controls width="800"></video>
    <script>
      const proxyBase = 'https://your-proxy.com/proxy?url=';
      const originalM3u8 = 'https://cdn.dotstream.buzz/.../master.m3u8';
      const url = proxyBase + encodeURIComponent(originalM3u8);

      const video = document.getElementById('video');
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
          video.play();
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', function() { video.play(); });
      }
    </script>
  </body>
</html>
```

---

## 9 — Deployment Tips (free & always-on)

* **Render free** sleeps — use an external ping service like UptimeRobot to keep it warm. This is a valid workaround but may hit monthly hour limits.
* **Railway / Fly.io** are good alternatives for small apps.
* If streaming large traffic consistently, consider a low-cost VPS (Hetzner, Contabo) or a small DigitalOcean droplet.

**HTTPS**: ensure your host provides TLS. Browsers require HTTPS for many media features.

---

## 10 — Troubleshooting & Debugging

**Slow responses**

* Cold starts (hosting sleep) — use a ping service.
* Puppeteer takes time to start — only use it when necessary.

**ERR\_INVALID\_ARGUMENT / setExtraHTTPHeaders errors**

* Only forward a safe subset of headers to Puppeteer. Don’t feed it the entire `req.headers` object.

**Proxy stream errors (ERR\_TUNNEL\_CONNECTION\_FAILED)**

* Usually caused by invalid or down proxy servers in your proxy rotation list — remove or fix them.

**CORS / X-Frame-Options**

* The proxy rewrites playlists and streams so the browser loads through your origin — this avoids most CORS/frame problems.

---

## 11 — Security & Legal

* This tool is for educational and legitimate personal use only. Do not use it to access content without rights.
* Rate limiting and logging are included to discourage abuse, but you are responsible for securing the app (auth, IP whitelist) in production.

---

## 12 — Credits & License

Created by **You** — adapt, remix, and use under the MIT License.

---

### Extra: Fancy ASCII Footer (Because flair matters)

```
██████╗ ██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗
██╔══██╗╚██╗ ██╔╝██╔═══██╗██╔══██╗╚██╗ ██╔╝
██████╔╝ ╚████╔╝ ██║   ██║██████╔╝ ╚████╔╝
██╔══██╗  ╚██╔╝  ██║   ██║██╔═══╝   ╚██╔╝  
██████╔╝   ██║   ╚██████╔╝██║        ██║   
╚═════╝    ╚═╝    ╚═════╝ ╚═╝        ╚═╝   
```

---

*If you want this converted into a `README.md` file in the project, tell me and I’ll add it to your repo.*
