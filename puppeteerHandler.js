const puppeteer = require('puppeteer');
const ProxyChain = require('proxy-chain');

const proxyList = [
  'http://username:password@proxy1.com:8000',
  'http://username:password@proxy2.com:8000',
];

function getRandomProxy() {
  return proxyList[Math.floor(Math.random() * proxyList.length)];
}

async function handleProxyRequest(url) {
  const oldProxyUrl = getRandomProxy();
  const newProxyUrl = await ProxyChain.anonymizeProxy(oldProxyUrl);

  const browser = await puppeteer.launch({
    args: [`--proxy-server=${newProxyUrl}`, '--no-sandbox'],
    headless: 'new',
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const html = await page.content();
  await browser.close();
  return html;
}

module.exports = { handleProxyRequest };
