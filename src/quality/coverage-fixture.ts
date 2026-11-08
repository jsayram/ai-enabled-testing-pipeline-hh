import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createShop } from '../app/server.ts';

export const coverageFixtures = [
  { id: 'healthy', label: 'Healthy checkout' },
  { id: 'duplicate-charge', label: 'Ordinary retry creates a duplicate charge' },
  { id: 'lost-reply-retry', label: 'Retry after a lost reply creates a duplicate charge' },
] as const;

export type CoverageFixtureId = typeof coverageFixtures[number]['id'];
type CommittedReply = { status: number; body: unknown };
export type CoverageFixture = { base: string; withholdReply: (key: string) => Promise<CommittedReply> };

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback fixture did not start');
  return 'http://127.0.0.1:' + address.port;
}

async function close(server: Server) {
  if (!server.listening) return;
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

export async function withCoverageFixture<T>(id: CoverageFixtureId, run: (fixture: CoverageFixture) => Promise<T>) {
  const shop = createShop(id === 'duplicate-charge' ? 'duplicate-charge' : 'healthy');
  let gateway: Server | undefined;
  let gatewayError: Error | undefined;
  let held: { key: string; committed: boolean; notify: (reply: CommittedReply) => void } | undefined;
  try {
    const upstream = await listen(shop);
    gateway = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', upstream);
        if (url.origin !== upstream) { res.writeHead(400).end(); return; }
        const headers = new Headers();
        for (const name of ['authorization', 'content-type', 'idempotency-key']) {
          const value = req.headers[name];
          if (typeof value === 'string') headers.set(name, value);
        }
        const key = headers.get('idempotency-key');
        const order = req.method === 'POST' && url.pathname === '/api/orders';
        const interrupted = order && held?.key === key ? held : undefined;
        // The held-out fault lives in the gateway. Only a retry after a withheld reply loses its key.
        if (id === 'lost-reply-retry' && interrupted?.committed) headers.set('idempotency-key', randomUUID());
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
        const result = await fetch(url, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(3000) });
        const payload = await result.text();
        if (interrupted && !interrupted.committed) {
          interrupted.committed = true;
          interrupted.notify({ status: result.status, body: JSON.parse(payload) as unknown });
          return;
        }
        res.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/octet-stream' });
        res.end(payload);
      } catch {
        gatewayError = new Error('Coverage fixture could not complete the upstream request');
        if (!res.destroyed) res.writeHead(502).end(gatewayError.message);
      }
    });
    const result = await run({
      base: await listen(gateway),
      withholdReply(key) {
        if (held) throw new Error('The fixture accepts one withheld reply per run');
        return new Promise(resolve => { held = { key, committed: false, notify: resolve }; });
      },
    });
    if (gatewayError) throw gatewayError;
    return result;
  } catch (error) {
    throw gatewayError ?? error;
  } finally {
    if (gateway) await close(gateway);
    await close(shop);
  }
}
