/* Offline PDF export. Source offsets follow the editor's data-s spans. */
'use strict';
window.exportAnnotatedPdf = async function ({ view, entries, resolved, title }) {
    if (!window.PDFLib || !window.fontkit || !window.PDF_EXPORT_FONT)
        throw new Error('Local PDF libraries or font are missing.');
    const { PDFDocument, PDFName, PDFHexString, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(PDF_EXPORT_FONT, { subset: true });
    doc.setTitle(title);
    doc.setCreator('Markdown Annotator');
    const supported = new Set(font.getCharacterSet());
    const safe = s => Array.from(s).map(c => supported.has(c.codePointAt(0)) ? c : '?').join('');
    const margin = 48, width = 595.28, height = 841.89;
    let page, y, line = [], lineWidth = 0, size = 11;
    const targets = entries.map(entry => ({ entry, range: resolved.get(entry.id), pages: new Map() }));
    const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
    newPage();
    function flush() {
        if (!line.length) return;
        if (y - size * 1.4 < margin) newPage();
        page.drawText(line.map(c => c.text).join(''), { x: margin, y, font, size, color: rgb(.12, .14, .16) });
        let x = margin;
        for (const target of targets) {
            const r = target.range;
            if (!r || !['exact', 'fuzzy'].includes(r.state) || r.start === undefined) continue;
            let left = null, right = null;
            for (const c of line) {
                if (c.offset !== null && c.offset < Math.max(r.end, r.start + 1) && c.offset + c.sourceLength > r.start) {
                    if (left === null) left = x;
                    right = x + c.width;
                }
                x += c.width;
            }
            x = margin;
            if (left !== null) {
                if (!target.pages.has(page)) target.pages.set(page, []);
                target.pages.get(page).push([left, y - size * .22, right, y + size]);
            }
        }
        y -= size * 1.5;
        line = []; lineWidth = 0;
    }
    function text(value, offset = null, preserve = false) {
        // Wrap at word boundaries; split exceptionally long words to avoid clipping.
        let sourceIndex = 0;
        for (const token of value.match(/\n|[^\S\n]+|[^\s]+/g) || []) {
            if (token === '\n' && preserve) { if (line.length) flush(); else y -= size * 1.5; sourceIndex++; continue; }
            const normalized = /^\s+$/.test(token) && !preserve ? ' ' : token;
            const tokenWidth = font.widthOfTextAtSize(safe(normalized), size);
            if (line.length && lineWidth + tokenWidth > width - margin * 2) flush();
            let local = 0;
            for (const original of normalized) {
                const char = original === '\t' ? '    ' : safe(original), w = font.widthOfTextAtSize(char, size);
                if (line.length && lineWidth + w > width - margin * 2) flush();
                if (preserve || char !== ' ' || line.length) {
                    line.push({ text: char, width: w, offset: offset === null ? null : offset + sourceIndex + local,
                        sourceLength: /^\s+$/.test(token) && !preserve ? token.length : original.length });
                    lineWidth += w;
                }
                local += original.length;
            }
            sourceIndex += token.length;
        }
    }
    function walk(node, sourceOffset = null, preserve = false) {
        if (node.nodeType === 3) { text(node.textContent, sourceOffset, preserve); return; }
        if (node.nodeType !== 1 || node.matches('button, .mermaid-diagram')) return;
        const block = node.matches('p,h1,h2,h3,h4,h5,h6,li,pre,tr,blockquote');
        if (block) { flush(); y -= 5; }
        const oldSize = size;
        if (/^H[1-6]$/.test(node.tagName)) size = 23 - Number(node.tagName[1]) * 2;
        if (node.tagName === 'PRE') size = 9;
        if (node.tagName === 'LI') text('• ');
        if (node.tagName === 'BR') flush();
        let offset = node.hasAttribute('data-s') ? Number(node.dataset.s) : sourceOffset;
        for (const child of node.childNodes) {
            walk(child, offset, preserve || node.tagName === 'PRE');
            if (offset !== null) offset += child.textContent.length;
        }
        if (node.matches('td,th')) text(' | ');
        if (block) { flush(); y -= 5; }
        size = oldSize;
    }
    walk(view); flush();
    function contents(target) {
        const e = target.entry, r = target.range;
        return [e.operation.toUpperCase(), r ? 'Anchor: ' + r.state + (r.relocated ? ' (relocated)' : '') : '',
            e.selection.text ? 'Selected: ' + e.selection.text : '',
            typeof e.value === 'string' ? 'Proposed text: ' + e.value : '', e.comment || ''].filter(Boolean).join('\n\n');
    }
    for (const target of targets) {
        for (const [targetPage, rects] of target.pages) {
            const bounds = [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])),
                Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
            // Explicit appearances keep highlights visible in readers that do not synthesize them.
            const stream = doc.context.flateStream('q /GS gs 1 0.8 0 rg\n' + rects.map(r =>
                `${r[0]} ${r[1]} ${r[2] - r[0]} ${r[3] - r[1]} re f`).join('\n') + '\nQ', {
                Type: 'XObject', Subtype: 'Form', BBox: bounds,
                Resources: { ExtGState: { GS: { Type: 'ExtGState', ca: .3, BM: 'Multiply' } } }
            });
            const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: bounds,
                QuadPoints: rects.flatMap(([l,b,r,t]) => [l,t,r,t,l,b,r,b]),
                Contents: PDFHexString.fromText(contents(target)), T: PDFHexString.fromText('Markdown Annotator'),
                NM: PDFHexString.fromText(target.entry.id), C: [1,.8,0], F: 4,
                AP: { N: doc.context.register(stream) } });
            targetPage.node.addAnnot(doc.context.register(annot));
        }
    }
    const missing = targets.filter(t => !t.pages.size);
    if (missing.length) {
        newPage(); size = 18; text('Annotations without a visible anchor'); flush(); size = 11;
        for (const target of missing) { y -= 12; text(contents(target), null, true); flush(); }
    }
    for (const [i, p] of doc.getPages().entries()) p.drawText(String(i + 1), {
        x: width - margin - 15, y: 25, size: 9, font, color: rgb(.4,.4,.4)
    });
    return doc.save();
};
