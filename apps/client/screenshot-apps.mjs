#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';

async function captureScreenshots() {
  console.log('🎬 Launching browser...');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // Retina display
  });
  const page = await context.newPage();

  // Create screenshots directory
  const screenshotsDir = join(process.cwd(), 'screenshots');
  try {
    mkdirSync(screenshotsDir, { recursive: true });
  } catch (_e) {
    // Directory already exists
  }

  console.log('\n📸 Capturing Admin Dashboard (http://localhost:3100)...');
  try {
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for any animations

    // Full page screenshot
    await page.screenshot({
      path: join(screenshotsDir, 'admin-dashboard-full.png'),
      fullPage: true,
    });
    console.log('   ✅ Saved: screenshots/admin-dashboard-full.png');

    // Viewport screenshot
    await page.screenshot({
      path: join(screenshotsDir, 'admin-dashboard-viewport.png'),
      fullPage: false,
    });
    console.log('   ✅ Saved: screenshots/admin-dashboard-viewport.png');

    // Try to capture specific sections if they exist
    const sections = [
      { selector: 'header', name: 'admin-header' },
      { selector: 'nav', name: 'admin-nav' },
      { selector: 'main', name: 'admin-main' },
    ];

    for (const section of sections) {
      try {
        const element = await page.$(section.selector);
        if (element) {
          await element.screenshot({
            path: join(screenshotsDir, `${section.name}.png`),
          });
          console.log(`   ✅ Saved: screenshots/${section.name}.png`);
        }
      } catch (_e) {
        // Element not found, skip
      }
    }
  } catch (error) {
    console.error('   ❌ Error capturing admin dashboard:', error.message);
  }

  console.log('\n📸 Capturing Client App (http://localhost:3200)...');
  try {
    await page.goto('http://localhost:3200', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for any animations

    // Full page screenshot
    await page.screenshot({
      path: join(screenshotsDir, 'client-app-full.png'),
      fullPage: true,
    });
    console.log('   ✅ Saved: screenshots/client-app-full.png');

    // Viewport screenshot
    await page.screenshot({
      path: join(screenshotsDir, 'client-app-viewport.png'),
      fullPage: false,
    });
    console.log('   ✅ Saved: screenshots/client-app-viewport.png');

    // Try to capture specific sections
    const sections = [
      { selector: 'header', name: 'client-header' },
      { selector: 'nav', name: 'client-nav' },
      { selector: 'main', name: 'client-main' },
    ];

    for (const section of sections) {
      try {
        const element = await page.$(section.selector);
        if (element) {
          await element.screenshot({
            path: join(screenshotsDir, `${section.name}.png`),
          });
          console.log(`   ✅ Saved: screenshots/${section.name}.png`);
        }
      } catch (_e) {
        // Element not found, skip
      }
    }
  } catch (error) {
    console.error('   ❌ Error capturing client app:', error.message);
  }

  // Mobile viewport screenshots
  console.log('\n📱 Capturing mobile views...');
  await context.setViewportSize({ width: 375, height: 667 }); // iPhone SE

  try {
    await page.goto('http://localhost:3100', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, 'admin-mobile.png'),
      fullPage: false,
    });
    console.log('   ✅ Saved: screenshots/admin-mobile.png');
  } catch (error) {
    console.error('   ❌ Error capturing admin mobile:', error.message);
  }

  try {
    await page.goto('http://localhost:3200', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, 'client-mobile.png'),
      fullPage: false,
    });
    console.log('   ✅ Saved: screenshots/client-mobile.png');
  } catch (error) {
    console.error('   ❌ Error capturing client mobile:', error.message);
  }

  await browser.close();
  console.log('\n✨ Screenshot capture complete! Check the screenshots/ directory.');
}

captureScreenshots().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
