import { expect, test } from '@playwright/test';

test('JS Widget', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask AI' }).waitFor({ state: 'visible' });
  expect(await page.evaluate('window.tidbai')).toMatchObject({ open: false });
});
