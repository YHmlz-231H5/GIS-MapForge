/**
 * e2e/full-submit-flow.spec.ts — replicate exact user flow + capture ALL errors.
 *
 * Flow: boot Electron → search "深圳龙华" → select first result →
 * open LayerCuration drawer → click submit → capture main+renderer console.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { existsSync } from 'fs';
import process from 'process';

const PROJECT_DIR = process.cwd();
const DIST_MAIN = join(PROJECT_DIR, 'dist-electron/main/index.cjs');

test.describe('Full submit flow', () => {
  test('search → drawer → submit → capture ALL logs', async () => {
    test.skip(!existsSync(DIST_MAIN), `Build first: ${DIST_MAIN} missing`);

    const captured: { source: string; type: string; text: string }[] = [];

    const electronApp = await electron.launch({
      args: ['.', '--disable-gpu', '--no-sandbox'],
      cwd: PROJECT_DIR,
      env: { ...process.env, MAP_LOAD_FROM_DIST: '1' },
      timeout: 30_000,
    });

    // Capture main process stderr/stdout
    const proc = electronApp.process();
    if (proc) {
      proc.stdout?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          if (line.trim()) captured.push({ source: 'main-stdout', type: 'info', text: line });
        }
      });
      proc.stderr?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          if (line.trim()) captured.push({ source: 'main-stderr', type: 'error', text: line });
        }
      });
    }

    const window = await electronApp.firstWindow({ timeout: 15_000 });
    window.on('console', (msg) => {
      captured.push({ source: 'renderer', type: msg.type(), text: msg.text() });
    });
    window.on('pageerror', (err) => {
      captured.push({ source: 'renderer', type: 'pageerror', text: String(err) });
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(6_000);

    // Dump page state
    const pageState = await window.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      inputs: document.querySelectorAll('input').length,
      buttons: document.querySelectorAll('button').length,
      rootHTML: document.getElementById('root')?.innerHTML?.slice(0, 500) ?? '(empty)',
    }));
    console.log('\n=== PAGE STATE ===');
    console.log(JSON.stringify(pageState, null, 2));

    // Try to type in search box
    const searchInput = window.locator('input[placeholder*="搜索"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('深圳龙华');
      await searchInput.press('Enter');
      await window.waitForTimeout(8_000); // Photon + DataV roundtrip
    } else {
      // Maybe page uses different layout — list all inputs
      const allInputs = await window.evaluate(() =>
        Array.from(document.querySelectorAll('input,textarea')).map(e => ({
          tag: e.tagName,
          placeholder: (e as HTMLInputElement).placeholder,
          id: e.id,
          class: e.className.slice(0, 60),
        }))
      );
      console.log('\n=== ALL INPUTS ===');
      console.log(JSON.stringify(allInputs, null, 2));
    }

    // Try "下一步" button
    const nextBtn = window.locator('button:has-text("下一步")').first();
    if (await nextBtn.count() > 0) {
      await nextBtn.click();
      await window.waitForTimeout(2_000);
    }

    // Try submit button
    const submitBtn = window.locator('button:has-text("生成 PBF")').first();
    if (await submitBtn.count() > 0) {
      const disabled = await submitBtn.isDisabled();
      console.log(`Submit button disabled: ${disabled}`);
      if (!disabled) {
        await submitBtn.click();
        await window.waitForTimeout(5_000); // IPC roundtrip
      }
    }

    // Print ALL captured log summary
    console.log(`\n=== LOG SUMMARY (${captured.length} entries) ===`);
    const errors = captured.filter(m => m.type === 'error' || m.type === 'pageerror');
    const warnings = captured.filter(m => m.type === 'warning');
    console.log(`Main-stderr: ${captured.filter(m => m.source === 'main-stderr').length}`);
    console.log(`Main-stdout: ${captured.filter(m => m.source === 'main-stdout').length}`);
    console.log(`Renderer errors: ${errors.filter(m => m.source === 'renderer').length}`);
    console.log(`Renderer warnings: ${warnings.length}`);

    console.log('\n--- MAIN STDERR ---');
    for (const m of captured.filter(m => m.source === 'main-stderr')) {
      console.log(m.text);
    }

    console.log('\n--- RENDERER ERRORS ---');
    for (const m of errors) {
      console.log(`[${m.type}] ${m.text.slice(0, 300)}`);
    }

    console.log('\n--- ALL SCHEDULER LOGS ---');
    for (const m of captured.filter(m => m.text.includes('[scheduler]'))) {
      console.log(m.text);
    }

    console.log('\n--- ALERT-LIKE ---');
    for (const m of captured.filter(m =>
      m.text.includes('failed') || m.text.includes('error') || m.text.includes('Error')
    )) {
      console.log(`[${m.source}] ${m.text.slice(0, 200)}`);
    }

    // Fail on any DB insert failure
    const dbFail = captured.find(m => m.text.includes('DB insert failed'));
    expect(dbFail, `DB insert failed: ${dbFail?.text}`).toBeUndefined();

    await electronApp.close();
  }, 90_000);
});
