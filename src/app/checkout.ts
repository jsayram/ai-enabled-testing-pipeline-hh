export const accounts = { a: 'demo-shopper-a', b: 'demo-shopper-b' } as const;
export type Account = keyof typeof accounts;
export const priceCents = 2400;

export const scenarios = [
  'healthy', 'selector-drift', 'checkout-regression', 'drift-with-regression',
  'eval-regression', 'duplicate-charge', 'privacy-leak',
] as const;
export type Scenario = typeof scenarios[number];

export function scenarioFrom(value: string): Scenario {
  if (!(scenarios as readonly string[]).includes(value)) throw new Error('Unknown scenario');
  return value as Scenario;
}

export type Receipt = { id: string; status: 'paid'; totalCents: number };
export type ApiResult = { status: number; body: object };

export function createCheckout(scenario: Scenario) {
  const orders = new Map<string, { owner: Account; receipt: Receipt }>();
  const attempts = new Map<string, { payment: string; result: ApiResult }>();
  let charges = 0;

  return {
    submit(owner: Account, key: string | undefined, payment: unknown): ApiResult {
      if (!key || !/^[a-z0-9-]{8,80}$/i.test(key) || (payment !== 'approved' && payment !== 'declined')) {
        return { status: 400, body: { error: 'invalid_checkout' } };
      }
      const namespace = owner + ':' + key;
      const previous = attempts.get(namespace);
      if (previous && previous.payment !== payment) return { status: 409, body: { error: 'key_conflict' } };
      if (previous && scenario !== 'duplicate-charge') return previous.result;

      let result: ApiResult;
      if (payment === 'declined' || scenario === 'checkout-regression' || scenario === 'drift-with-regression') {
        result = { status: 402, body: { error: 'payment_declined' } };
      } else {
        const receipt: Receipt = { id: 'order-' + ++charges, status: 'paid', totalCents: priceCents };
        orders.set(receipt.id, { owner, receipt });
        result = { status: 201, body: receipt };
      }
      attempts.set(namespace, { payment, result });
      return result;
    },
    lookup(owner: Account, id: string): ApiResult {
      const order = orders.get(id);
      if (!order || (order.owner !== owner && scenario !== 'privacy-leak')) {
        return { status: 404, body: { error: 'not_found' } };
      }
      return { status: 200, body: order.receipt };
    },
    chargeCount: () => charges,
  };
}
