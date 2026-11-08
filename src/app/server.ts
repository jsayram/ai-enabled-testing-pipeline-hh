import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accounts, createCheckout, scenarioFrom } from './checkout.ts';
import type { Account, Scenario } from './checkout.ts';
import { isSupportResponse, replaySupport } from './support.ts';
import { pathToFileURL } from 'node:url';
import { randomInt } from 'node:crypto';
import { identifyLocalModel } from '../ai/ollama.ts';
import { localSupportModel } from './product-model.ts';
import type { SupportModel } from './support.ts';

function html(scenario: Scenario) {
  const testId = scenario === 'selector-drift' || scenario === 'drift-with-regression' ? 'place-order' : 'checkout-submit';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Demo storefront</title><main>
  <h1>Demo storefront</h1>
  <section aria-labelledby="checkout"><h2 id="checkout">Checkout</h2>
    <p>Everyday essentials · <span data-testid="price">$24.00</span></p>
    <button data-testid="${testId}" data-action="submit-order">Place order</button>
    <p role="status" aria-label="Order confirmation"></p>
  </section>
  <section aria-labelledby="support"><h2 id="support">Shop support</h2>
    <label for="question">Ask about shop policy</label><input id="question" maxlength="400">
    <button data-action="ask-support">Ask support</button>
    <p role="status" aria-label="Support reply"></p>
  </section>
  </main><script>
  const button = document.querySelector('[data-action="submit-order"]');
  const orderOutput = document.querySelector('[aria-label="Order confirmation"]');
  const attempt = crypto.randomUUID();
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const r = await fetch('/api/orders', {method:'POST', headers:{'content-type':'application/json','authorization':'Bearer demo-shopper-a','idempotency-key':attempt}, body:JSON.stringify({payment:'approved'})});
      const order = await r.json();
      orderOutput.textContent = r.ok && order.status === 'paid' ? 'Order ' + order.id + ' confirmed · $' + (order.totalCents / 100).toFixed(2) : 'Order could not be placed';
    } catch { orderOutput.textContent = 'Order status unavailable'; }
    finally { button.disabled = false; }
  });
  document.querySelector('[data-action="ask-support"]').addEventListener('click', async () => {
    const output = document.querySelector('[aria-label="Support reply"]');
    try {
      const r = await fetch('/api/support', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({question:document.querySelector('#question').value})});
      output.textContent = r.ok ? (await r.json()).text : 'Support unavailable';
    } catch { output.textContent = 'Support unavailable'; }
  });
  </script></html>`;
}

function json(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new Error('Body too large');
    chunks.push(chunk);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Invalid body');
  return body as Record<string, unknown>;
}

function authenticate(req: IncomingMessage): Account | undefined {
  return (Object.keys(accounts) as Account[]).find(key => 'Bearer ' + accounts[key] === req.headers.authorization);
}

export function createShop(scenario: Scenario, support: SupportModel = replaySupport(scenario), seed = () => 0) {
  const checkout = createCheckout(scenario);
  return createServer(async (req, res) => {
    const method = req.method;
    const path = req.url?.split('?')[0];
    if (method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html(scenario));
    }
    if (method === 'GET' && path === '/health') return json(res, 200, { ready: true });
    if (method === 'POST' && path === '/api/support') {
      let question: unknown;
      try { ({ question } = await readBody(req)); }
      catch { return json(res, 400, { error: 'invalid_body' }); }
      if (typeof question !== 'string' || !question.trim() || question.length > 400) {
        return json(res, 400, { error: 'invalid_question' });
      }
      try {
        const response = await support(question, seed());
        return isSupportResponse(response) ? json(res, 200, response) : json(res, 502, { error: 'invalid_response' });
      } catch { return json(res, 502, { error: 'support_unavailable' }); }
    }
    if (path === '/api/orders' || path?.startsWith('/api/orders/')) {
      const owner = authenticate(req);
      if (!owner) return json(res, 401, { error: 'unauthorized' });
      if (method === 'POST' && path === '/api/orders') {
        let payment: unknown;
        try { ({ payment } = await readBody(req)); }
        catch { return json(res, 400, { error: 'invalid_body' }); }
        const key = req.headers['idempotency-key'];
        const result = checkout.submit(owner, typeof key === 'string' ? key : undefined, payment);
        return json(res, result.status, result.body);
      }
      if (method === 'GET' && path.startsWith('/api/orders/')) {
        const result = checkout.lookup(owner, path.slice('/api/orders/'.length));
        return json(res, result.status, result.body);
      }
    }
    return json(res, 404, { error: 'not_found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const scenario = scenarioFrom(process.env.SHOP_SCENARIO ?? 'healthy');
  const model = process.env.OLLAMA_PRODUCT_MODEL ? await identifyLocalModel(process.env.OLLAMA_PRODUCT_MODEL) : null;
  const shop = model ? createShop(scenario, localSupportModel(model.tag), () => randomInt(2 ** 31)) : createShop(scenario);
  shop.listen(port, '127.0.0.1', () => {
    console.log('Demo storefront: http://127.0.0.1:' + port);
  });
}
