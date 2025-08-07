// proxy/puppeteerHandler.js
// Renders a URL with puppeteer (JS-challenged pages) and returns resulting HTML.

let puppeteer;
try {
  puppeteer = require('puppeteer-core'); // prefer core
} catch (e) {
  // fallback if puppeteer-core isn't installed
  puppeteer = require('puppeteer');
}

const DEFAULT_CHROME_PATH = process.env.CHROME_PATH || null; // optional override

function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.198 Safari/537.36'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

async function renderWithPuppeteer(url, extraHeaders = {}) {
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // executablePath: DEFAULT_CHROME_PATH // uncomment if you have Chrome path
  };
  if (DEFAULT_CHROME_PATH) launchOptions.executablePath = DEFAULT_CHROME_PATH;

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();

    await page.setUserAgent(getRandomUserAgent());

    // Only set safe headers
    const safe = {};
    ['authorization', 'cookie', 'accept-language', 'referer'].forEach(h => {
      if (extraHeaders[h]) safe[h] = extraHeaders[h];
    });
    await page.setExtraHTTPHeaders(safe);

    // Some target sites detect headless — enable some flags to reduce detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Allow JS challenges to run (Cloudflare)
    await page.waitForTimeout(4000);

    // Wait for network idle (gives SPA time to fetch)
    try {
      await page.waitForNetworkIdle({ idleTime: 1000, timeout: 20000 });
    } catch (e) {
      // if network idle times out, continue anyway
    }

    const content = await page.content();
    await browser.close();
    return content;
  } catch (err) {
    try { await browser.close(); } catch (_) {}
    throw err;
  }
}

module.exports = { renderWithPuppeteer };
