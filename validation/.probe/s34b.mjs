import { webkit } from 'playwright-core';
import { serveDist } from '../serve-dist.mjs';
const mode = process.argv[2];
const host = await serveDist();
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(8000);
page.on('request', r => /PdfOverlay/.test(r.url()) && console.log('req:', r.url()));
await page.goto(`${host.url}/embed-skin`);
await page.locator('.skin-reader .score-system svg').first().waitFor();
await page.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
await page.route('**/*PdfOverlay*.js', route => route.abort());
await page.locator('.skin-reader .pdf-trigger').click();
const dlg = page.locator('.skin-reader').getByRole('dialog',{name:'Export PDF'});
await dlg.getByRole('alert').waitFor();
await page.unroute('**/*PdfOverlay*.js');
if (mode==='reload') await page.reload();
if (mode==='histgo') await Promise.all([page.waitForEvent('load'), dlg.getByRole('button',{name:'Reload page'}).click()]);
if (mode==='goto') await page.goto(`${host.url}/embed-skin`);
if (mode==='newpage') { const p2 = await browser.newPage(); p2.on('request', r => /PdfOverlay/.test(r.url()) && console.log('req2:', r.url())); await p2.goto(`${host.url}/embed-skin`); await p2.locator('.skin-reader .score-system svg').first().waitFor(); await p2.evaluate(() => window.__skin.setSkin({bar:['pdf']})); await p2.locator('.skin-reader .pdf-trigger').click(); try { await p2.getByLabel('Paper size').waitFor(); console.log(mode,'OK'); } catch { console.log(mode,'FAIL'); } process.exit(0); }
if (mode==='norel') { await page.locator('.skin-reader .pdf-trigger').click({force:true}).catch(()=>{}); await dlg.getByRole('button',{name:'Cancel'}).click(); }
await page.locator('.skin-reader .score-system svg').first().waitFor();
await page.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
await page.locator('.skin-reader .pdf-trigger').click();
try { await page.getByLabel('Paper size').waitFor(); console.log(mode,'OK'); } catch { console.log(mode,'FAIL'); }
process.exit(0);
