import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const assetDirectory = path.resolve('apps/goarrive/assets/coach-discovery');
const sourceNames = (await readdir(assetDirectory)).filter((name) => name.endsWith('.png'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

try {
  for (const sourceName of sourceNames) {
    const sourcePath = path.join(assetDirectory, sourceName);
    const outputPath = sourcePath.replace(/\.png$/i, '.webp');
    await page.goto(pathToFileURL(sourcePath).href, { waitUntil: 'load' });
    const encoded = await page.evaluate(async () => {
      const image = document.querySelector('img');
      if (!image) throw new Error('Browser did not render the source image.');
      if (!image.complete) await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context is unavailable.');
      context.drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', 0.82).split(',')[1];
    });
    await writeFile(outputPath, Buffer.from(encoded, 'base64'));
    process.stdout.write(`${path.relative(process.cwd(), outputPath)}\n`);
  }
} finally {
  await browser.close();
}
