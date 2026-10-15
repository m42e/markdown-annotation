// Requires jsdom (test-only); run with node tests/test_pdf_export.cjs.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const root = require('path').join(__dirname, '../simple-editor/');
const dom = new JSDOM('<article id="view"></article>', { runScripts: 'outside-only' });
const w = dom.window;
for (const file of ['lib/pdf-lib.min.js','lib/fontkit.umd.js','lib/pdf-font.js','pdf-export.js']) w.eval(fs.readFileSync(root+file,'utf8'));
const view = w.document.querySelector('article');
view.innerHTML = '<h1><span data-s="0">Review export</span></h1><p><span data-s="20">'+ ('Long passage with café, Grüße, and comments. '.repeat(350)) +'</span></p><pre><code><span data-s="20000">first line\nsecond line</span></code></pre>';
const entries = [{id:'one',operation:'reword',selection:{text:'Long passage'},value:'New wording',comment:'A Unicode comment: Grüße ✓'}, {id:'two',operation:'comment',selection:{text:'missing'},comment:'Unresolved note'}];
(async()=>{
const bytes = await w.exportAnnotatedPdf({view,entries,resolved:new Map([['one',{state:'exact',start:20,end:6000}],['two',{state:'unmatched'}]]),title:'Test'});
if (process.env.PDF_TEST_OUTPUT) fs.writeFileSync(process.env.PDF_TEST_OUTPUT, bytes);
const d = await w.PDFLib.PDFDocument.load(bytes);
let annotations=0;
for(const p of d.getPages()){
 const a=p.node.Annots(); if(!a)continue;
 for(let i=0;i<a.size();i++){
 const item=d.context.lookup(a.get(i));
 if(item.get(w.PDFLib.PDFName.of('Subtype')).toString()!=='/Highlight')throw Error('Not a native highlight');
 const contents=item.get(w.PDFLib.PDFName.of('Contents')).decodeText();
 if(!contents.includes('Grüße')) throw Error('Unicode comment lost');
 annotations++;
 }
}
if(d.getPageCount()<3 || annotations<2)throw Error('Pagination or cross-page annotation failed');
if (annotations !== 2) throw Error('Unmatched entry was incorrectly highlighted');
const last = d.getPages().at(-1);
if (last.node.Annots()?.size()) throw Error('Appendix should not have anchored highlights');
view.innerHTML = '';
const emptyBytes = await w.exportAnnotatedPdf({view, entries:[], resolved:new Map(), title:'Empty'});
const empty = await w.PDFLib.PDFDocument.load(emptyBytes);
if (empty.getPageCount() !== 1) throw Error('Empty document should export one page');
console.log('PASS:',d.getPageCount(),'pages,',annotations,'native highlights; Unicode comments, unmatched appendix, empty document');
})().catch(e=>{console.error(e);process.exit(1)});
