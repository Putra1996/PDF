import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "./browser.mjs";
const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(HERE, ".."));
const OUT = path.resolve(process.env.FIXTURES_DIR || path.join(ROOT, "fixtures", "editor-ocr"));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium();
const page = await browser.newPage();
await page.setContent(`<canvas id="c" width="1240" height="1754"></canvas>`);
await page.evaluate(() => {
  const c=document.querySelector('#c'), x=c.getContext('2d');
  x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.fillStyle='#111';
  x.font='bold 64px Arial'; x.fillText('SCAN TEST DOCUMENT',110,220);
  x.font='40px Arial'; x.fillText('Editable words on this page.',110,330);
  x.fillText('Change font and replace picture.',110,410);
});
const png = Buffer.from((await page.locator('#c').evaluate((c)=>c.toDataURL('image/png'))).split(',')[1],'base64');
await page.evaluate(() => {
  const c=document.querySelector('#c'),x=c.getContext('2d');
  c.width=240;c.height=180;x.fillStyle='#fff';x.fillRect(0,0,240,180);
  x.strokeStyle='#2455c3';x.lineWidth=8;x.strokeRect(8,8,224,164);
  x.fillStyle='#e35b2f';x.fillRect(48,42,144,96);
});
const picture = Buffer.from((await page.locator('#c').evaluate((c)=>c.toDataURL('image/png'))).split(',')[1],'base64');
await browser.close();
const pdf = await PDFDocument.create();
const img = await pdf.embedPng(png);
const pic = await pdf.embedPng(picture);
for (const rotation of [0, 90, 180, 270]) {
  const p = pdf.addPage([595,842]);
  p.drawImage(img,{x:0,y:0,width:595,height:842});
  p.drawImage(pic,{x:400,y:280,width:110,height:82});
  p.setRotation(require("pdf-lib").degrees(rotation));
}
fs.writeFileSync(path.join(OUT,'scan.pdf'),await pdf.save());
console.log(`Fixture scan.pdf dibuat di ${OUT}`);
