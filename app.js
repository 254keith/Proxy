// app.js
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const NodeCache = require('node-cache');
const winston = require('winston');
const axios = require('axios');
const { renderWithPuppeteer } = require('./proxy/puppeteerHandler');

const app = express();
const PORT = process.env.PORT || 3002;

// -------- Winston Logger Setup --------
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'proxy.log') }),
    new winston.transports.Console()
  ]
});

// -------- Cache --------
const cache = new NodeCache({ stdTTL: 300 });

// -------- Rate limiter & logging --------
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use(morgan('dev'));

// -------- Header rewriting middleware --------
app.use((req, res, next) => {
  req.headers['x-custom-proxy'] = 'true';
  res.setHeader('X-Powered-By', 'ProxyMagic');
  next();
});

// -------- Views / static --------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// -------- Home route --------
app.get('/', (req, res) => {
  res.render('index', { url: req.query.url });
});

// -------- Admin dashboard --------
app.get('/admin', (req, res) => {
  const keys = cache.keys();
  const stats = { totalCached: keys.length, keys };
  fs.readFile(path.join(logDir, 'proxy.log'), 'utf-8', (err, data) => {
    const logs = data ? data.split('\n').slice(-200) : [];
    res.render('admin', { stats, logs });
  });
});

// -------- Helper: safe header subset to forward --------
function buildSafeHeaders(clientHeaders, extra = {}) {
  const safe = {};
  const whitelist = ['authorization', 'cookie', 'accept-language', 'range', 'user-agent', 'referer'];
  for (const k of whitelist) {
    if (clientHeaders[k]) safe[k] = clientHeaders[k];
  }
  return Object.assign({}, safe, extra);
}

// -------- Main proxy route --------
app.get('/proxy', async (req, res) => {
  if (!req.query.url) {
    logger.warn('Proxy called without url');
    return res.status(400).send('Missing url query parameter');
  }

  // Decode and validate URL
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(req.query.url);
    new URL(targetUrl);
  } catch (e) {
    logger.warn(`Invalid URL received: ${req.query.url}`);
    return res.status(400).send(`Invalid URL: ${e.message}`);
  }

  // Cache key
  const cacheKey = `proxy:${targetUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.info(`CACHE HIT: ${targetUrl}`);
    // cached object may have { type: 'html'|'json'|'stream', payload }
    if (cached.type === 'html') return res.send(cached.payload);
    if (cached.type === 'json') return res.send(cached.payload);
    // for streams we avoid caching full stream
  }

  // Build headers for upstream
  const safeHeaders = buildSafeHeaders(req.headers);

  // Try to fetch HEAD first (some servers don't allow HEAD)
  let headRespHeaders = null;
  try {
    const head = await axios.request({
      method: 'head',
      url: targetUrl,
      headers: safeHeaders,
      timeout: 15000,
      maxRedirects: 5
    });
    headRespHeaders = head.headers;
  } catch (err) {
    // HEAD may fail; ignore and fall back to GET stream probe
    logger.info(`HEAD failed for ${targetUrl} - falling back to GET probe: ${err.message}`);
  }

  // Helper to decide type from headers or URL
  function contentTypeFrom(headers, url) {
    if (!headers) {
      if (/\.(mp4|mkv|webm|mov|avi)(\?|$)/i.test(url)) return 'video';
      if (/\/api\//i.test(url) || /\.json($|\?)/i.test(url)) return 'json';
      if (/\.html?($|\?)/i.test(url)) return 'html';
      return null;
    }
    const ct = headers['content-type'] || '';
    if (ct.includes('text/html')) return 'html';
    if (ct.includes('application/json') || ct.includes('+json')) return 'json';
    if (ct.startsWith('video/') || ct.includes('octet-stream') || ct.includes('mpeg')) return 'video';
    return null;
  }

  const preType = contentTypeFrom(headRespHeaders, targetUrl);

  try {
    // If it's HTML (or unknown but seems HTML) render with Puppeteer
    if (preType === 'html' || (preType === null && /\.(html?|\/$)/i.test(targetUrl))) {
      logger.info(`Using Puppeteer for HTML render: ${targetUrl}`);
      const html = await renderWithPuppeteer(targetUrl, safeHeaders);
      cache.set(cacheKey, { type: 'html', payload: html });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    // If it's JSON (API), fetch via axios and return nicely or embed video
    if (preType === 'json' || /\/api\//i.test(targetUrl) || /\.json($|\?)/i.test(targetUrl)) {
      logger.info(`Fetching JSON via axios: ${targetUrl}`);
      const apiResp = await axios.get(targetUrl, {
        headers: safeHeaders,
        timeout: 30000,
        maxRedirects: 5
      });
      const data = apiResp.data;

      // If the JSON contains a streaming link, show a player
      const streamingLink =
        (data && data.data && (data.data.streamingLink || data.data.stream)) ||
        (data && data.streamingLink) ||
        null;

      if (streamingLink) {
        logger.info(`JSON contains streamingLink -> rendering player: ${streamingLink}`);
        const html = `
          <!doctype html>
          <html>
            <head><meta charset="utf-8"><title>ProxyVideo</title></head>
            <body style="font-family: sans-serif; padding:20px;">
              <h2>Playing stream</h2>
              <p>Source (proxied): ${streamingLink}</p>
              <video controls autoplay style="width:100%;max-width:1000px;">
                <source src="/proxy?url=${encodeURIComponent(streamingLink)}" />
                Your browser does not support the video tag.
              </video>
              <hr />
              <h3>Raw JSON</h3>
              <pre>${JSON.stringify(data, null, 2)}</pre>
            </body>
          </html>
        `;
        // do not cache streaming pages (they may vary), but can cache JSON separately
        cache.set(cacheKey, { type: 'json', payload: JSON.stringify(data) });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }

      // Otherwise return pretty JSON
      cache.set(cacheKey, { type: 'json', payload: JSON.stringify(data) });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify(data));
    }

    // For video or other binary content: stream it
    logger.info(`Attempting stream proxy via axios for: ${targetUrl}`);
    // Forward Range header if present (for seeking)
    if (req.headers.range) safeHeaders.range = req.headers.range;

    const streamResp = await axios.get(targetUrl, {
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      headers: safeHeaders,
      timeout: 120000,
      maxRedirects: 5
    });

    // Forward relevant headers
    const upstreamHeaders = streamResp.headers;
    if (upstreamHeaders['content-type']) res.setHeader('Content-Type', upstreamHeaders['content-type']);
    if (upstreamHeaders['content-length']) res.setHeader('Content-Length', upstreamHeaders['content-length']);
    if (upstreamHeaders['accept-ranges']) res.setHeader('Accept-Ranges', upstreamHeaders['accept-ranges']);
    if (upstreamHeaders['content-range']) res.setHeader('Content-Range', upstreamHeaders['content-range']);
    if (upstreamHeaders['cache-control']) res.setHeader('Cache-Control', upstreamHeaders['cache-control']);

    // Pipe upstream stream directly to client
    streamResp.data.pipe(res);
    streamResp.data.on('end', () => {
      logger.info(`Stream complete for ${targetUrl}`);
    });
    streamResp.data.on('error', (err) => {
      logger.error(`Stream error for ${targetUrl}: ${err.message}`);
      try { res.end(); } catch (e) {}
    });

    // Do not cache big streams
    return;
  } catch (err) {
    logger.error(`Proxy error for ${targetUrl}: ${err.stack || err.message}`);
    return res.status(500).send(`Internal Server Error: ${err.message || err}`);
  }
});

// -------- global error handler --------
app.use((err, req, res, next) => {
  logger.error(`UNCAUGHT ERROR: ${err.stack || err.message}`);
  res.status(500).send(`Internal Server Error`);
});

app.listen(PORT, () => {
  logger.info(`Proxy server running on http://localhost:${PORT}`);
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
// Enable CORS for all requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
