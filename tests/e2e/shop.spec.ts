import { expect, test } from '@playwright/test';

test('approved payment shows a paid receipt', async ({ page }, info) => {
  await page.goto('/');
  const checkout = page.getByRole('region', { name: 'Checkout', exact: true });
  await expect(checkout).toBeVisible();
  await expect(checkout.getByTestId('price')).toHaveText('$24.00');

  const primary = checkout.getByTestId('checkout-submit');
  let button = primary;
  if (await primary.count() === 0) {
    // Shadow recovery is for locator absence only. A known action binding is required.
    button = checkout.getByRole('button', { name: 'Place order', exact: true });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute('data-action', 'submit-order');
    info.annotations.push({ type: 'locator-drift', description: 'checkout-submit → scoped Place order (same action binding)' });
  } else {
    await expect(primary).toHaveCount(1);
    await expect(primary).toHaveAttribute('data-action', 'submit-order');
  }
  const response = page.waitForResponse(r =>
    new URL(r.url()).origin === new URL(page.url()).origin &&
    new URL(r.url()).pathname === '/api/orders' && r.request().method() === 'POST');
  await button.click();
  const receiptResponse = await response;
  expect(receiptResponse.status()).toBe(201);
  const receipt = await receiptResponse.json() as { id: string; status: string; totalCents: number };
  expect(receipt.id).toMatch(/^order-\d+$/);
  expect(receipt).toMatchObject({ status: 'paid', totalCents: 2400 });
  await expect(checkout.getByRole('status', { name: 'Order confirmation' }))
    .toHaveText('Order ' + receipt.id + ' confirmed · $24.00');
});

test('support renders the published shipping window', async ({ page }) => {
  await page.goto('/');
  const support = page.getByRole('region', { name: 'Shop support', exact: true });
  await support.getByLabel('Ask about shop policy').fill('When will my order ship?');
  await support.getByRole('button', { name: 'Ask support' }).click();
  await expect(support.getByRole('status', { name: 'Support reply' })).toContainText('3–5 business days');
});
