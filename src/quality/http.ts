import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const shoppers = { a: 'demo-shopper-a', b: 'demo-shopper-b' };

export async function request(base: string, path: string, init?: RequestInit) {
  return fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(3000) });
}

function authorization(who: keyof typeof shoppers) {
  return { authorization: 'Bearer ' + shoppers[who] };
}

export function postOrder(base: string, key: string, payment: string, who: keyof typeof shoppers = 'a') {
  return request(base, '/api/orders', {
    method: 'POST', headers: { ...authorization(who), 'idempotency-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ payment }),
  });
}

export async function apiContract(base: string) {
  assert.equal((await request(base, '/api/orders/order-1')).status, 401, 'Anonymous callers must authenticate');
  const key = randomUUID();
  const first = await postOrder(base, key, 'approved');
  assert.equal(first.status, 201, 'Approved payment must create a paid order');
  const body = await first.json() as { id: string; status: string; totalCents: number };
  assert.match(body.id, /^order-\d+$/);
  assert.equal(body.status, 'paid');
  assert.equal(body.totalCents, 2400);
  const [a, b] = await Promise.all([postOrder(base, key, 'approved'), postOrder(base, key, 'approved')]);
  for (const repeat of [a, b]) {
    assert.equal(repeat.status, 201);
    assert.deepEqual(await repeat.json(), body, 'Idempotent retries must return the original order');
  }
  assert.equal((await postOrder(base, key, 'declined')).status, 409, 'A key cannot change the original payment intent');
  assert.equal((await postOrder(base, 'bad', 'approved')).status, 400);
  const declined = await postOrder(base, randomUUID(), 'declined');
  assert.equal(declined.status, 402);
  assert.deepEqual(await declined.json(), { error: 'payment_declined' });
  const other = await postOrder(base, key, 'approved', 'b');
  assert.equal(other.status, 201);
  assert.notEqual((await other.json() as { id: string }).id, body.id, 'Idempotency key must be scoped to the shopper');
  const owner = await request(base, '/api/orders/' + body.id, { headers: authorization('a') });
  assert.equal(owner.status, 200);
  assert.deepEqual(await owner.json(), body);
  const foreign = await request(base, '/api/orders/' + body.id, { headers: authorization('b') });
  assert.equal(foreign.status, 404, 'One shopper must never read another shopper’s order');
  assert.deepEqual(await foreign.json(), { error: 'not_found' });
  const reply = await request(base, '/api/support', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '  ' }),
  });
  assert.equal(reply.status, 400, 'Blank support requests must be rejected');
  return 'Payment, retries, account isolation and support request contract passed';
}

export async function loadSmoke(base: string, total = 160, concurrency = 8) {
  const times: number[] = [];
  let next = 0;
  let errors = 0;
  const wall = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next++ < total) {
      const start = performance.now();
      try {
        const result = await postOrder(base, randomUUID(), 'approved');
        const body = await result.json() as { status?: string; totalCents?: number };
        if (result.status !== 201 || body.status !== 'paid' || body.totalCents !== 2400) errors++;
      } catch { errors++; }
      times.push(performance.now() - start);
    }
  }));
  times.sort((a, b) => a - b);
  const p95Ms = Math.round(times[Math.ceil(total * .95) - 1]! * 10) / 10;
  return {
    total, concurrency, errors, p95Ms,
    p95BudgetMs: 250,
    requestsPerSecond: Math.round(total * 1000 / (performance.now() - wall)),
    pass: errors === 0 && p95Ms <= 250,
  };
}
