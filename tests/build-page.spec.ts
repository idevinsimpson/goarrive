import { test, expect } from '@playwright/test';

test("should navigate to the Build page and display search input", async ({ page }) => {
  await page.goto("/build");
  await expect(page.getByPlaceholder("Search Build...")).toBeVisible();
});
