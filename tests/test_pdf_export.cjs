// Requires jsdom (test-only); run with node tests/test_pdf_export.cjs.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const root = require('path').join(__dirname, '../simple-editor/');
const dom = new JSDOM('<article id="view"></article>', { runScripts: 'outside-only' });
const w = dom.window;
for (const file of ['lib/pdf-lib.min.js','lib/fontkit.umd.js','lib/pdf-font.js','lib/pdf-font-styles.js','pdf-export.js']) w.eval(fs.readFileSync(root+file,'utf8'));
const view = w.document.querySelector('article');
view.innerHTML = '<h1><span data-s="0">Review export</span></h1><p><span data-s="20">'+ ('Long passage with café, Grüße, and comments. '.repeat(350)) +'</span></p><pre><code><span data-s="20000">first line\nsecond line</span></code></pre>';
const entries = [{id:'one',operation:'reword',selection:{text:'Long passage'},value:'New wording',comment:'A Unicode comment: Grüße ✓'}, {id:'two',operation:'comment',selection:{text:'missing'},comment:'Unresolved note'}];
(async()=>{
const bytes = await w.exportAnnotatedPdf({view,entries,resolved:new Map([['one',{state:'exact',start:20,end:6000}],['two',{state:'unmatched'}]]),title:'Test'});
if (process.env.PDF_TEST_OUTPUT) fs.writeFileSync(process.env.PDF_TEST_OUTPUT, bytes);
const d = await w.PDFLib.PDFDocument.load(bytes);
if (d.getCreator() !== 'Markdown Annotator (https://m42e.de/markdown-annotation/)')
 throw Error('PDF creator metadata must include the annotator homepage');
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
// A long table exercises column layout, wrapping, header repetition, and cell anchors.
view.innerHTML = '<h1>Structured document</h1><p><strong>Bold</strong> and <em>italic</em>, '
    + '<code>inline code</code>, <del>removed</del>, <a href="https://example.com">a link</a>.</p>'
    + '<blockquote><p>A quote with its own margin.</p></blockquote>'
    + '<ol start="3"><li>Third item</li><li>Fourth item<ul><li>Nested item</li></ul></li></ol>'
    + '<hr><pre><code>  indented code\n\nnext line</code></pre>'
    + '<table><thead><tr><th><span data-s="0">Name</span></th><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>'
    + Array.from({length:65}, (_,i) => '<tr><td>Item '+i+'</td><td>'+('Wrapped table text. '.repeat(i===30?600:4))
        + '</td><td style="text-align:right"><span data-s="'+(10000+i*1000)+'">'+i+'.50</span></td></tr>').join('')
    + '</tbody></table><p>After the table.</p>';
const tableEntries = [
    {id:'header',operation:'comment',selection:{text:'Name'},comment:'Repeated header'},
    {id:'cell',operation:'comment',selection:{text:'64.50'},comment:'Last amount'}
];
const tableBytes = await w.exportAnnotatedPdf({view,entries:tableEntries,resolved:new Map([
    ['header',{state:'exact',start:0,end:4}],['cell',{state:'exact',start:74000,end:74005}]
]),title:'Tables and formatting'});
if (process.env.PDF_TEST_OUTPUT) fs.writeFileSync(process.env.PDF_TEST_OUTPUT.replace(/\.pdf$/, '.tables.pdf'), tableBytes);
const tableDoc = await w.PDFLib.PDFDocument.load(tableBytes);
let headers=0, cells=0, links=0;
const fontNames = new Set();
for (const p of tableDoc.getPages()) {
    const fontDict = p.node.Resources().lookup(w.PDFLib.PDFName.of('Font'));
    for (const [,ref] of fontDict.entries()) fontNames.add(tableDoc.context.lookup(ref).get(w.PDFLib.PDFName.of('BaseFont')).toString());
    const annots = p.node.Annots();
    for (let i=0;i<(annots?.size()||0);i++) {
        const a=tableDoc.context.lookup(annots.get(i));
        if(a.get(w.PDFLib.PDFName.of('Subtype')).toString()==='/Link') {links++;continue;}
        const id=a.get(w.PDFLib.PDFName.of('NM')).decodeText();
        const rect=a.get(w.PDFLib.PDFName.of('Rect')).asArray().map(n=>n.asNumber());
        if(rect[0]<48 || rect[2]>548 || rect[1]<48 || rect[3]>795) throw Error('Table highlight outside content bounds');
        if(id==='header') headers++;
        if(id==='cell') {cells++;if(rect[0]<350)throw Error('Last-column highlight is misplaced');}
    }
}
if(tableDoc.getPageCount()<5 || headers<5 || cells!==1 || links!==1) throw Error('Table pagination, repeated headers, cell anchors, or links failed');
if(![...fontNames].some(n=>n.includes('Bold')) || ![...fontNames].some(n=>n.includes('Italic')) || ![...fontNames].some(n=>n.includes('Mono')))
    throw Error('Styled fonts were not embedded');
console.log('PASS: text export, Unicode comments, unresolved appendix, empty document; tables across',
    tableDoc.getPageCount(),'pages,',headers,'annotated headers, oversized rows, cell anchors, styled fonts, and links');

})().catch(e=>{console.error(e);process.exit(1)});
