// Optional integration check: requires playwright-core and a Chromium executable.
// PDF_TEST_BROWSER selects the executable; PDF_TEST_OUTPUT keeps the downloaded PDF.
const { chromium } = require('playwright-core');
const { pathToFileURL } = require('url');
const path = require('path');
(async () => {
    const browser = await chromium.launch({ executablePath: process.env.PDF_TEST_BROWSER, headless: true });
    try {
        const page = await browser.newPage({ acceptDownloads: true });
        // Simulate the cached export-only script from before PDF reopening existed.
        // The editor must request the versioned script to pick up the importer.
        await page.route('**/pdf-export.js', route => route.fulfill({
            contentType: 'application/javascript',
            body: 'window.exportAnnotatedPdf = async () => { throw new Error("Stale PDF script"); };'
        }));
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
        await page.goto(pathToFileURL(path.join(__dirname, '../simple-editor/index.html')).href);
        await page.waitForSelector('.mermaid-diagram svg');
        const pendingDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download annotated PDF' }).click();
        const download = await pendingDownload;
        if (process.env.PDF_TEST_OUTPUT) await download.saveAs(process.env.PDF_TEST_OUTPUT);
        if (await download.failure()) throw Error('PDF download failed');
        const attachment = await page.evaluate(async bytes => {
            const source = await extractMarkdownFromPdf(new Uint8Array(bytes));
            if (!source.text.includes('```json:annotation')) throw Error('Missing annotation payload');
            return source;
        }, Array.from(require('fs').readFileSync(await download.path())));
        await page.locator('#fileMd').setInputFiles({ name: 'roundtrip.pdf', mimeType: 'application/pdf',
            buffer: require('fs').readFileSync(await download.path()) });
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Loaded embedded payload.'));
        await page.evaluate(source => {
            const saved = JSON.parse(localStorage.getItem('markdown-annotator:v2'));
            if (saved.docName !== source.name || !source.text.startsWith(saved.body))
                throw Error('Reopening lost Markdown source or filename');
            const payload = JSON.parse(source.text.split('```json:annotation').at(-1).split('```')[0]);
            if (JSON.stringify(saved.payload) !== JSON.stringify(payload))
                throw Error('Reopening changed annotation payload');
        }, attachment);
        await page.waitForSelector('.mermaid-diagram svg');
        const result = await page.evaluate(async () => {
            const view = document.querySelector('#view').cloneNode(true);
            const cell = view.querySelector('td span[data-s]');
            const source = view.querySelector('.mermaid-source span[data-s]');
            const entries = [cell, source].map((span, i) => ({ id: 'anchor-' + i,
                operation: 'comment', selection: { text: span.textContent }, comment: 'Keep this native annotation' }));
            const resolved = new Map([cell, source].map((span, i) => ['anchor-' + i, {
                state: 'exact', start: Number(span.dataset.s), end: Number(span.dataset.s) + span.textContent.length
            }]));
            const bytes = await exportAnnotatedPdf({ view, entries, resolved, title: 'Structured annotation check' });
            const doc = await PDFLib.PDFDocument.load(bytes);
            let images = 0;
            const anchored = new Set();
            for (const p of doc.getPages()) {
                const x = p.node.Resources().lookupMaybe(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict);
                if (x) for (const [, ref] of x.entries()) {
                    if (doc.context.lookup(ref).dict.get(PDFLib.PDFName.of('Subtype')).toString() === '/Image') images++;
                }
                const annots = p.node.Annots();
                for (let i = 0; i < (annots?.size() || 0); i++) {
                    const a = doc.context.lookup(annots.get(i));
                    if (a.get(PDFLib.PDFName.of('Subtype')).toString() === '/Highlight')
                        anchored.add(a.get(PDFLib.PDFName.of('NM')).decodeText());
                }
            }
            // Exercise the source fallback without SVG/canvas rendering as well.
            view.querySelector('.mermaid-diagram svg').remove();
            const fallbackBytes = await exportAnnotatedPdf({ view, entries: [entries[1]],
                resolved: new Map([['anchor-1', resolved.get('anchor-1')]]), title: 'Diagram fallback' });
            const fallback = await PDFLib.PDFDocument.load(fallbackBytes);
            const fallbackAnchored = fallback.getPages().some(p => p.node.Annots()?.size());
            return { images, anchors: anchored.size, fallbackAnchored };
        });
        if (result.images < 1 || result.anchors !== 2 || !result.fallbackAnchored)
            throw Error('Diagram image, table/source annotations, or source fallback failed: ' + JSON.stringify(result));
        if (errors.length || requests.length) throw Error(JSON.stringify({ errors, requests }));
        console.log('PASS: offline file:// download, Mermaid image, table/source native annotations, source fallback, no network requests or page errors');
    } finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
