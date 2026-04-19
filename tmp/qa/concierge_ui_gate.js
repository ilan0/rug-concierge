const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

function startProxy(port, hostHeader) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: 3000,
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: hostHeader },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      req.pipe(proxyReq);
      proxyReq.on('error', () => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('proxy error');
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function waitForResponse(page, timeout = 22000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const loading = await page.locator('text=Searching the collection').count();
    if (loading === 0) return true;
    await page.waitForTimeout(350);
  }
  return false;
}

async function send(page, text) {
  const box = page.locator('textarea[placeholder*="Describe"]');
  await box.waitFor({ state: 'visible', timeout: 12000 });
  await box.fill(text);
  await page.keyboard.press('Enter');
}

async function checkTargets(page) {
  return page.evaluate(() => {
    const selectors = 'button,[role="button"],a[href],textarea,input,[data-recommendation-card="true"]';
    const els = Array.from(document.querySelectorAll(selectors));
    return els
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 40),
          width: Math.round(r.width),
          height: Math.round(r.height),
          hidden: cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none',
        };
      })
      .filter((x) => !x.hidden && (x.width < 44 || x.height < 44));
  });
}

async function run(runName) {
  const out = path.resolve(`tmp/qa/concierge-redesign/${runName}`);
  fs.mkdirSync(out, { recursive: true });
  const gates = [];

  const jj = await startProxy(3211, 'jjrugs.rugdesk.app');
  const demo = await startProxy(3212, 'demo.rugdesk.app');
  const browser = await chromium.launch({ headless: true });

  try {
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await p.screenshot({ path: path.join(out, '01-empty-mobile.png'), fullPage: false });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const targetFails = await checkTargets(p);
      gates.push({ gate: 'F', state: 'empty-mobile', pass: !overflow, detail: overflow ? 'overflow' : 'ok' });
      gates.push({ gate: 'B', state: 'empty-mobile', pass: targetFails.length === 0, detail: targetFails.slice(0, 10) });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3212/concierge', { waitUntil: 'networkidle' });
      await p.screenshot({ path: path.join(out, '02-empty-missing-logo-tablet.png'), fullPage: false });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
      const p = await c.newPage();
      await p.route('**/logo-mark.png**', (r) => r.abort());
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(out, '03-empty-broken-logo-desktop.png'), fullPage: false });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await send(p, 'Show me the collection');
      await p.waitForTimeout(550);
      await p.screenshot({ path: path.join(out, '04-first-message-loading-tablet.png'), fullPage: false });
      const responded = await waitForResponse(p);
      gates.push({ gate: 'D', state: 'loading-to-response', pass: responded, detail: responded ? 'smooth' : 'timeout' });
      await p.screenshot({ path: path.join(out, '05-active-thread-tablet.png'), fullPage: false });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await send(p, 'Show me traditional rugs');
      await waitForResponse(p);
      await send(p, 'Now show me something warmer');
      await waitForResponse(p);
      await p.screenshot({ path: path.join(out, '06-two-exchanges-rail-desktop.png'), fullPage: false });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const targetFails = await checkTargets(p);
      gates.push({ gate: 'F', state: 'active-desktop', pass: !overflow, detail: overflow ? 'overflow' : 'ok' });
      gates.push({ gate: 'B', state: 'active-desktop', pass: targetFails.length === 0, detail: targetFails.slice(0, 10) });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      for (let i = 0; i < 8; i++) {
        await send(p, `Show another option ${i + 1}`);
        await waitForResponse(p);
      }
      await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(out, '07-long-thread-jump-desktop-xl.png'), fullPage: false });
      let jumpVisible = await p.locator('text=Jump to latest').count();
      if (jumpVisible === 0) {
        for (let i = 8; i < 12; i++) {
          await send(p, `Show another option ${i + 1}`);
          await waitForResponse(p);
        }
        await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await p.waitForTimeout(500);
        jumpVisible = await p.locator('text=Jump to latest').count();
      }
      gates.push({ gate: 'E', state: 'jump-visible', pass: jumpVisible > 0, detail: `count=${jumpVisible}` });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 768, height: 1024 } });
      const p = await c.newPage();
      await p.route('**/api/chat', (route) => route.abort());
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await send(p, 'Show me rugs');
      await p.waitForTimeout(1200);
      await p.screenshot({ path: path.join(out, '08-error-retry-tablet.png'), fullPage: false });
      const retryHeight = await p.locator('button:has-text("Retry")').first().boundingBox();
      gates.push({ gate: 'H', state: 'retry-target', pass: !!retryHeight && retryHeight.height >= 44, detail: retryHeight });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await send(p, 'Show me rugs for my living room');
      await waitForResponse(p);
      await p.screenshot({ path: path.join(out, '09-active-mobile.png'), fullPage: false });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      gates.push({ gate: 'F', state: 'active-mobile', pass: !overflow, detail: overflow ? 'overflow' : 'ok' });
      await c.close();
    }

    {
      const c = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const p = await c.newPage();
      await p.goto('http://127.0.0.1:3211/concierge', { waitUntil: 'networkidle' });
      await p.screenshot({ path: path.join(out, '10-empty-tablet-landscape.png'), fullPage: false });
      await c.close();
    }

    fs.writeFileSync(path.join(out, 'gate-results.json'), JSON.stringify(gates, null, 2));
    console.log(JSON.stringify({ out, gates }, null, 2));
  } finally {
    await browser.close();
    await new Promise((r) => jj.close(r));
    await new Promise((r) => demo.close(r));
  }
}

const runName = process.argv[2] || 'run-temp';
run(runName).catch((err) => {
  console.error(err);
  process.exit(1);
});
