import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser.mjs";
const ROOT=path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)),".."));
const FIX=path.join(ROOT,"fixtures","editor-ocr","scan.pdf");
const PORT=Number(process.env.PORT||8097); const SHOT=path.join(ROOT,"docs","audit-editor-ocr"); fs.mkdirSync(SHOT,{recursive:true}); let pass=0,fail=0;
const check=(n,ok,d="")=>{ok?pass++:fail++;console.log(`${ok?"✓":"✗"} ${n}${d?" — "+d:""}`)};
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".wasm":"application/wasm",".gz":"application/gzip",".traineddata":"application/octet-stream",".pdf":"application/pdf"};
const srv=http.createServer((req,res)=>{const u=decodeURIComponent((req.url||"/").split("?")[0]);let f=path.join(ROOT,u==="/"?"index.html":u);if(!f.startsWith(ROOT)||!fs.existsSync(f))return res.writeHead(404).end();res.writeHead(200,{"content-type":mime[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res)});
await new Promise(r=>srv.listen(PORT,"127.0.0.1",r));
const browser=await chromium(); const page=await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[];
page.on("pageerror",e=>errors.push(String(e)));
try {
 await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:"load"}); await page.waitForTimeout(700);
 await page.evaluate(()=>window.PDFApp.setTab("tools")); await page.waitForTimeout(250);
 await page.click('#toolCategories [data-tool="edit"]'); await page.waitForTimeout(400);
 await page.setInputFiles("#toolInput",FIX); await page.waitForTimeout(2500);
 check("Editor loads scanned PDF",await page.evaluate(()=>window.PDFToolsEditor.debug().pages===1));
 const ocrStarted=Date.now();
 await page.click('[data-ed="ocr"]');
 await page.waitForFunction(()=>{const b=document.querySelector('[data-ed="ocr"]');return b&&!b.disabled},{timeout:90000});
 const ocrMs=Date.now()-ocrStarted;
 check("OCR satu halaman selesai dalam batas 60 detik",ocrMs<60000,`${(ocrMs/1000).toFixed(1)} dtk termasuk worker init`);
 let d=await page.evaluate(()=>window.PDFToolsEditor.debug());
 const ops=d.ops.filter(o=>o.ocrGenerated);
 check("OCR recognizes multiple editable lines",ops.length>=2,`lines=${ops.length}; ${ops.map(o=>o.text).join(" / ")}`);
 check("OCR results are editable text layers",ops.length>0&&ops.every(o=>o.k==="text"&&o.newItem&&o.box.w>0&&o.box.h>0));
 await page.waitForTimeout(1500);
 await page.screenshot({path:path.join(SHOT,"ocr-preview.png"),fullPage:true});
 if(ops.length){
   await page.locator('.ed-box.ed-new').first().click(); await page.waitForTimeout(200);
   check("Click OCR text selects inspector",await page.locator('[data-field="font"]').count().then(n=>n>0));
   await page.locator('[data-field="text"] textarea').fill("Edited OCR heading"); await page.waitForTimeout(200);
   await page.locator('[data-field="font"]').selectOption({index:1}); await page.waitForTimeout(300);
   d=await page.evaluate(()=>window.PDFToolsEditor.debug());
   check("Text and font edits update preview state",d.ops.some(o=>o.ocrGenerated&&o.text==="Edited OCR heading"&&o.font!=="helvetica"),JSON.stringify(d.ops.find(o=>o.text==="Edited OCR heading")||{}));
   check("Undo history available after OCR/edit",d.undoDepth>0,`undo=${d.undoDepth}`);
 }
 const canvas=await page.locator('.ed-canvas').evaluate(c=>({w:c.width,h:c.height}));
 check("Editor preview rendered after OCR",canvas.w>500&&canvas.h>500,`${canvas.w}x${canvas.h}`);
 check("No fatal page errors",errors.length===0,errors.join(" | "));
} catch(e){check("Audit run",false,e.stack||String(e));}
await browser.close(); await new Promise(r=>srv.close(r));
console.log(`\n=== OCR EDITOR: ${pass} lulus / ${fail} gagal ===`);
if(fail)process.exitCode=1;
