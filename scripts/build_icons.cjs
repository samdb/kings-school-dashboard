// Rasterise the existing school vector shield, without redrawing the logo.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined});
  try {
    const svg = await fs.readFile(path.join(root, 'static/app-icon.svg'), 'utf8');
    for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
      const page = await browser.newPage({viewport: {width: size, height: size}, deviceScaleFactor: 1});
      await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
      await page.screenshot({path: path.join(root, 'pages', name)});
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
