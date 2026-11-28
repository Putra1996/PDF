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
const browser=await chromium(); const page=await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[]; let previewPage1="";
page.on("pageerror",e=>errors.push(String(e)));
try {
 await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:"load"}); await page.waitForTimeout(700);
 await page.evaluate(()=>window.PDFApp.setTab("tools")); await page.waitForTimeout(250);
 await page.click('#toolCategories [data-tool="ocr"]'); await page.waitForTimeout(400);
 await page.setInputFiles("#toolInput",FIX); await page.waitForTimeout(2500);
 check("OCR feature loads scanned PDF with its live editor",await page.evaluate(()=>window.PDFToolsEditor.debug().pages===4));
 const ocrStarted=Date.now();
 await page.click('[data-ed="ocr"]');
 await page.waitForFunction(()=>{const b=document.querySelector('[data-ed="ocr"]');return b&&!b.disabled},{timeout:90000});
 const ocrMs=Date.now()-ocrStarted;
 check("OCR satu halaman selesai dalam batas 60 detik",ocrMs<60000,`${(ocrMs/1000).toFixed(1)} dtk termasuk worker init`);
 let d=await page.evaluate(()=>window.PDFToolsEditor.debug());
 const ops=d.ops.filter(o=>o.ocrGenerated);
 check("OCR recognizes multiple editable lines",ops.length>=2,`lines=${ops.length}; ${ops.map(o=>o.text).join(" / ")}`);
 check("OCR results are editable text layers",ops.length>0&&ops.every(o=>o.k==="text"&&o.newItem&&o.box.w>0&&o.box.h>0));
 await page.evaluate(()=>window.PDFToolsEditor.deselect()); await page.waitForTimeout(250);
 const layerChoice=page.locator(".ed-layer-name").first();
 if(await layerChoice.count()){await layerChoice.click();await page.waitForTimeout(200);}
 const layerSelected=await page.evaluate(()=>{const d=window.PDFToolsEditor.debug();return !!d.sel&&!!d.sel.opId;});
 check("OCR layer list can select text even when boxes overlap",layerSelected);
 await page.evaluate(()=>window.PDFToolsEditor.deselect()); await page.waitForTimeout(150);
 const outline=await page.locator(".ed-box.ed-ocr-box").first().evaluate(e=>({background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderStyle,selected:e.classList.contains("sel")}));
 check("Unselected OCR boxes do not tint/hide the scan",outline.border==="dashed"&&!outline.selected&&/(rgba\(.*?,\s*0\)|transparent)/.test(outline.background),JSON.stringify(outline));
 check("OCR feature preview detects separate image object",d.images>=2,`images=${d.images}`);
 if(ops.length){
   await page.locator('.ed-box.ed-new').first().click(); await page.waitForTimeout(200);
   check("Click OCR text selects inspector",await page.locator('[data-field="font"]').count().then(n=>n>0));
   await page.locator('[data-field="text"] textarea').fill("Edited OCR heading"); await page.waitForTimeout(200);
   await page.locator('[data-field="font"]').selectOption({index:1}); await page.waitForTimeout(300);
   d=await page.evaluate(()=>window.PDFToolsEditor.debug());
   check("Text and font edits update preview state",d.ops.some(o=>o.ocrGenerated&&o.text==="Edited OCR heading"&&o.font!=="helvetica"),JSON.stringify(d.ops.find(o=>o.text==="Edited OCR heading")||{}));
   check("Undo history available after OCR/edit",d.undoDepth>0,`undo=${d.undoDepth}`);
 }
 await page.locator(".ed-box.ed-img").last().click(); await page.waitForTimeout(150);
 const imageWidth=Number(await page.locator('[data-field="width"] input').inputValue());
 await page.locator('[data-field="width"] input').fill(String(imageWidth+15)); await page.waitForTimeout(250);
 const imageEdit=await page.evaluate(()=>window.PDFToolsEditor.debug().ops.find(o=>o.k==="image"));
 check("Image size is directly editable in OCR preview",!!imageEdit&&imageEdit.box.w>imageEdit.copyFrom.w,JSON.stringify(imageEdit||{}));
 await page.waitForTimeout(350);
 previewPage1=await page.locator('.ed-canvas').evaluate(c=>c.toDataURL('image/png'));
 await page.screenshot({path:path.join(SHOT,"ocr-preview.png"),fullPage:true});
 for (let pageNo=2;pageNo<=4;pageNo++) {
   await page.click('[data-ed="next"]'); await page.waitForTimeout(180);
   await page.click('[data-ed="ocr"]');
   await page.waitForFunction(()=>{const b=document.querySelector('[data-ed="ocr"]');return b&&!b.disabled},{timeout:90000});
   const pageOps=await page.evaluate(()=>window.PDFToolsEditor.debug().ops.filter(o=>o.ocrGenerated).length);
   check(`Rotasi ${[0,90,180,270][pageNo-1]}°: OCR menghasilkan lapisan edit`,pageOps>=3,`baris=${pageOps}`);
 }
 const canvas=await page.locator('.ed-canvas').evaluate(c=>({w:c.width,h:c.height}));
 check("Editor preview rendered after OCR",canvas.w>500&&canvas.h>500,`${canvas.w}x${canvas.h}`);
 check("No fatal page errors",errors.length===0,errors.join(" | "));
 await page.locator("#toolRunBtn").click();
 await page.waitForSelector("#toolResults a",{timeout:120000});
 const href=await page.locator("#toolResults a").first().getAttribute("href");
 const finalOutput=await page.evaluate(async (url)=>{
   const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());
   const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise;
   const texts=[], imageCounts=[];
   for(let n=1;n<=pdf.numPages;n++){
     const p=await pdf.getPage(n), content=await p.getTextContent(), list=await p.getOperatorList();
     texts.push(content.items.map(i=>i.str).join(" "));
     const ops=window.pdfjsLib.OPS;
     imageCounts.push(list.fnArray.filter(fn=>fn===ops.paintImageXObject||fn===ops.paintInlineImageXObject).length);
   }
   await pdf.destroy(); return {texts,imageCounts,pages:pdf.numPages};
 },href);
 check("OCR tool output contains edited preview text",finalOutput.texts[0].includes("Edited OCR heading"),finalOutput.texts[0].slice(0,300));
 check("Edited OCR output replaces old recognized heading",!finalOutput.texts[0].includes("SCAN TEST DOCUMENT"),finalOutput.texts[0].slice(0,300));
 check("Edited image is included in the exported PDF",finalOutput.imageCounts[0]>=3,`image operators=${finalOutput.imageCounts[0]}`);
 check("OCR-edited lines persist through all four page rotations",finalOutput.pages===4&&finalOutput.texts.slice(1).every(t=>t.includes("SCAN TEST DOCUMENT")),finalOutput.texts.map(t=>t.slice(0,55)).join(" / "));
 const visualMatch=await page.evaluate(async({url,preview})=>{
   const bytes=new Uint8Array(await(await fetch(url)).arrayBuffer());
   const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise, p=await pdf.getPage(1);
   const ref=new Image(); ref.src=preview; await ref.decode();
   const scale=ref.width/p.getViewport({scale:1}).width, vp=p.getViewport({scale});
   const out=document.createElement("canvas");out.width=ref.width;out.height=ref.height;
   await p.render({canvasContext:out.getContext("2d"),viewport:vp}).promise;
   const a=ref.getContext?null:null;
   const ca=document.createElement("canvas");ca.width=ref.width;ca.height=ref.height;ca.getContext("2d").drawImage(ref,0,0);
   const x=ca.getContext("2d").getImageData(0,0,ca.width,ca.height).data;
   const y=out.getContext("2d").getImageData(0,0,out.width,out.height).data;
   let near=0;for(let i=0;i<x.length;i+=4){if(Math.abs(x[i]-y[i])<32&&Math.abs(x[i+1]-y[i+1])<32&&Math.abs(x[i+2]-y[i+2])<32)near++;}
   await pdf.destroy();return {ratio:near/(x.length/4),size:`${out.width}x${out.height}`};
 },{url:href,preview:previewPage1});
 check("Rendered PDF visually matches edited OCR preview",visualMatch.ratio>0.88,`${(visualMatch.ratio*100).toFixed(1)}% pixels within Δ32; ${visualMatch.size}`);
 await page.locator('[data-field="mode"] select').selectOption("clean");
 await page.locator("#toolRunBtn").click();
 await page.waitForFunction(()=>{const b=document.querySelector("#toolRunBtn");return b&&b.textContent==="Proses"},{timeout:120000});
 const cleanHref=await page.locator("#toolResults a").first().getAttribute("href");
 const cleanOut=await page.evaluate(async(url)=>{
   const bytes=new Uint8Array(await(await fetch(url)).arrayBuffer());
   const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise, texts=[];
   for(let n=1;n<=pdf.numPages;n++){const c=await(await pdf.getPage(n)).getTextContent();texts.push(c.items.map(i=>i.str).join(" "));}
   const list=await(await pdf.getPage(1)).getOperatorList(),ops=window.pdfjsLib.OPS;
   const images=list.fnArray.filter(fn=>fn===ops.paintImageXObject||fn===ops.paintInlineImageXObject).length;
   await pdf.destroy();return {pages:texts.length,texts,images};
 },cleanHref);
 check("Mode latar putih mempertahankan teks edit di semua halaman",cleanOut.pages===4&&cleanOut.texts[0].includes("Edited OCR heading")&&cleanOut.texts.slice(1).every(t=>t.includes("SCAN TEST DOCUMENT")),cleanOut.texts.map(t=>t.slice(0,45)).join(" / "));
 check("Mode latar putih tetap menyertakan gambar yang diedit",cleanOut.images>=1,`image operators=${cleanOut.images}`);
 await page.locator("#toolResults button",{hasText:"Edit hasil di preview"}).click();
 await page.waitForFunction(()=>window.PDFToolsEditor&&window.PDFToolsEditor.debug().pages===4&&window.PDFToolsEditor.debug().texts>0&&document.querySelectorAll(".ed-box.ed-text").length>0,{timeout:15000});
 check("Hasil OCR dapat dibuka kembali ke preview editor",await page.locator("#toolFileList .tf-name").textContent().then(t=>t.includes("scan-ocr.pdf")));
 await page.locator(".ed-box.ed-text").first().click();
 const editable=page.locator('[data-field="text"] textarea');
 await editable.waitFor({state:"visible",timeout:5000});
 check("Teks hasil OCR tetap dapat dipilih setelah diproses",await editable.count().then(n=>n===1));
 await editable.fill("Post OCR direct edit"); await page.waitForTimeout(250);
 await page.locator("#toolRunBtn").click();
 await page.waitForFunction(()=>{const b=document.querySelector("#toolRunBtn");return b&&b.textContent==="Proses"},{timeout:120000});
 const secondHref=await page.locator("#toolResults a").first().getAttribute("href");
 const secondText=await page.evaluate(async(url)=>{
   const bytes=new Uint8Array(await(await fetch(url)).arrayBuffer()), pdf=await window.pdfjsLib.getDocument({data:bytes}).promise;
   const c=await(await pdf.getPage(1)).getTextContent();const t=c.items.map(i=>i.str).join(" ");await pdf.destroy();return t;
 },secondHref);
 check("Edit ulang sesudah OCR tersimpan ke PDF",secondText.replace(/\s+/g," ").includes("Post OCR direct edit"),secondText.slice(0,180));
 await page.click('[data-ed="reset"]'); await page.waitForTimeout(180);
 await page.evaluate(()=>{
   window.__realOcrCreateWorker=window.Tesseract.createWorker;
   window.Tesseract.createWorker=async()=>({
     recognize:async()=>({data:{blocks:[{paragraphs:[{lines:[
       {text:"HIGH CONFIDENCE",confidence:92,bbox:{x0:120,y0:160,x1:720,y1:230}},
       {text:"LOW NOISE",confidence:9,bbox:{x0:120,y0:260,x1:500,y1:320}},
     ]}]}]}}),
     terminate:async()=>{},
   });
 });
 await page.click('[data-ed="ocr"]');
 await page.waitForFunction(()=>{const b=document.querySelector('[data-ed="ocr"]');return b&&!b.disabled},{timeout:15000});
 const confidenceOps=await page.evaluate(()=>window.PDFToolsEditor.debug().ops.filter(o=>o.ocrGenerated).map(o=>o.text));
 check("Ambang confidence membuang baris OCR yang meragukan",confidenceOps.length===1&&confidenceOps[0]==="HIGH CONFIDENCE",confidenceOps.join(" / "));
 await page.evaluate(()=>{window.Tesseract.createWorker=window.__realOcrCreateWorker;delete window.__realOcrCreateWorker;});
} catch(e){check("Audit run",false,e.stack||String(e));}
await browser.close(); await new Promise(r=>srv.close(r));
console.log(`\n=== OCR EDITOR: ${pass} lulus / ${fail} gagal ===`);
if(fail)process.exitCode=1;
