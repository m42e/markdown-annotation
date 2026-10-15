/* Offline PDF export. Every laid-out glyph retains its Markdown source offset. */
'use strict';
window.exportAnnotatedPdf = async function ({ view, entries, resolved, title }) {
    if (!window.PDFLib || !window.fontkit || !window.PDF_EXPORT_FONT || !window.PDF_EXPORT_FONTS)
        throw new Error('Local PDF libraries or fonts are missing.');
    const { PDFDocument, PDFHexString, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const fonts = {};
    for (const [key, data] of Object.entries({ regular: PDF_EXPORT_FONT, ...PDF_EXPORT_FONTS })) {
        fonts[key] = await doc.embedFont(data, {
            subset: true, fontFeatures: { liga: false, clig: false, kern: false }
        });
    }
    const font = fonts.regular;
    doc.setTitle(title);
    doc.setCreator('Markdown Annotator');
    const supported = new Map(Object.entries(fonts).map(([key, f]) => [key, new Set(f.getCharacterSet())]));
    const margin = 48, width = 595.28, height = 841.89, bodyWidth = width - margin * 2;
    const ink = rgb(.12, .14, .16), border = rgb(.78, .81, .84);
    const baseStyle = { size: 11, bold: false, italic: false, mono: false, code: false, strike: false, link: null };
    let page, y;
    const targets = entries.map(entry => ({ entry, range: resolved.get(entry.id), pages: new Map() }));
    const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
    newPage();
    function fontKey(style) {
        return style.mono ? 'mono' : style.bold ? (style.italic ? 'boldItalic' : 'bold') : style.italic ? 'italic' : 'regular';
    }
    function glyphs(value, offset = null, style = baseStyle, preserve = false) {
        let index = 0;
        const key = fontKey(style), f = fonts[key];
        return Array.from(value).map(original => {
            const text = original === '\n' ? '\n' : original === '\t' ? (preserve ? '    ' : ' ')
                : supported.get(key).has(original.codePointAt(0)) ? original : '?';
            const g = { text, width: text === '\n' ? 0 : f.widthOfTextAtSize(text, style.size),
                offset: offset === null ? null : offset + index, sourceLength: original.length, style, key };
            index += original.length;
            return g;
        });
    }
    function collect(node, style = baseStyle, offset = null, preserve = false) {
        if (node.nodeType === 3) return glyphs(node.textContent, offset, style, preserve);
        if (node.nodeType !== 1 || node.matches('button, .mermaid-diagram, .mermaid-bar')) return [];
        if (node.tagName === 'BR') return glyphs('\n', null, style, true);
        style = { ...style };
        if (node.matches('strong,b,th')) style.bold = true;
        if (node.matches('em,i')) style.italic = true;
        if (node.matches('del,s')) style.strike = true;
        if (node.tagName === 'CODE') { style.mono = true; style.code = !preserve; }
        if (node.tagName === 'A') style.link = node.getAttribute('href');
        if (node.hasAttribute('data-s')) offset = Number(node.dataset.s);
        const result = [];
        for (const child of node.childNodes) {
            for (const g of collect(child, style, offset, preserve)) result.push(g);
            if (offset !== null) offset += child.textContent.length;
        }
        return result;
    }
    function wrap(input, maxWidth, preserve = false) {
        // Tokenize across inline style boundaries so emphasis never inserts word breaks.
        const tokens = [];
        let token = [], whitespace = null;
        for (const g of input) {
            const space = /^\s+$/.test(g.text);
            if (g.text === '\n' && preserve) {
                if (token.length) tokens.push(token);
                tokens.push([g]); token = []; whitespace = null; continue;
            }
            if (space !== whitespace && token.length) { tokens.push(token); token = []; }
            token.push(g); whitespace = space;
        }
        if (token.length) tokens.push(token);
        const lines = [];
        let current = [], used = 0;
        const flush = () => { lines.push(current); current = []; used = 0; };
        for (let group of tokens) {
            if (group[0].text === '\n' && preserve) { flush(); continue; }
            const space = /^\s+$/.test(group[0].text);
            if (space && !preserve) {
                const first = group[0], last = group[group.length - 1];
                group = [{ ...first, text: ' ', width: fonts[first.key].widthOfTextAtSize(' ', first.style.size),
                    sourceLength: first.offset === null || last.offset === null ? first.sourceLength : last.offset + last.sourceLength - first.offset }];
                if (!current.length) continue;
            }
            const groupWidth = group.reduce((sum, g) => sum + g.width, 0);
            if (current.length && used + groupWidth > maxWidth) {
                if (!preserve) while (current.length && /^\s+$/.test(current.at(-1).text)) current.pop();
                flush();
                if (space && !preserve) continue;
            }
            for (const g of group) {
                if (current.length && used + g.width > maxWidth) flush();
                current.push(g); used += g.width;
            }
        }
        if (current.length) lines.push(current);
        return lines;
    }
    function drawLine(line, x, baseline) {
        const start = x;
        // Draw runs rather than individual characters, retaining selectable text and font styles.
        let run = [], runX = x;
        function paint() {
            if (!run.length) return;
            const first = run[0], style = first.style, w = run.reduce((sum, g) => sum + g.width, 0);
            if (style.code) page.drawRectangle({ x: runX, y: baseline - style.size * .24,
                width: w, height: style.size * 1.3, color: rgb(.94,.95,.96) });
            page.drawText(run.map(g => g.text).join(''), { x: runX, y: baseline,
                font: fonts[first.key], size: style.size, color: style.link ? rgb(.03,.36,.68) : ink });
            if (style.strike || style.link) page.drawLine({
                start: { x: runX, y: baseline + (style.strike ? style.size * .3 : -1.5) },
                end: { x: runX + w, y: baseline + (style.strike ? style.size * .3 : -1.5) },
                thickness: .6, color: style.link ? rgb(.03,.36,.68) : ink
            });
            if (style.link && /^(https?:|mailto:)/i.test(style.link)) page.node.addAnnot(doc.context.register(doc.context.obj({
                Type: 'Annot', Subtype: 'Link', Rect: [runX, baseline - 2, runX + w, baseline + style.size],
                Border: [0,0,0], A: { S: 'URI', URI: PDFHexString.fromText(style.link) }
            })));
            run = [];
        }
        for (const g of line) {
            if (run.length && (g.style !== run[0].style || g.key !== run[0].key)) { paint(); runX = x; }
            run.push(g); x += g.width;
        }
        paint();
        for (const target of targets) {
            const r = target.range;
            if (!r || !['exact', 'fuzzy'].includes(r.state) || r.start === undefined) continue;
            let left = null, right = null, top = baseline, bottom = baseline;
            x = start;
            for (const g of line) {
                if (g.offset !== null && g.offset < Math.max(r.end, r.start + 1) && g.offset + g.sourceLength > r.start) {
                    if (left === null) left = x;
                    right = x + g.width;
                    top = Math.max(top, baseline + g.style.size);
                    bottom = Math.min(bottom, baseline - g.style.size * .22);
                }
                x += g.width;
            }
            if (left !== null) {
                if (!target.pages.has(page)) target.pages.set(page, []);
                target.pages.get(page).push([left, bottom, right, top]);
            }
        }
    }
    function ensure(space) { if (y - space < margin) newPage(); }
    function paragraph(input, { left = margin, right = margin, size = 11, preserve = false,
        background = false, quote = false, after = 9, align = 'left' } = {}) {
        const padding = background || quote ? 9 : 0;
        const lines = wrap(input, width - left - right - padding * 2, preserve);
        for (const line of lines) {
            const step = size * 1.5;
            ensure(step + (background ? 5 : 0));
            if (background) page.drawRectangle({ x: left, y: y - step, width: width - left - right,
                height: step + 4, color: rgb(.96,.97,.98) });
            if (quote) page.drawLine({ start: { x: left + 2, y: y + 3 }, end: { x: left + 2, y: y - step },
                thickness: 2, color: border });
            const lineWidth = line.reduce((sum, g) => sum + g.width, 0);
            const spare = width - left - right - padding * 2 - lineWidth;
            drawLine(line, left + padding + (align === 'right' ? spare : align === 'center' ? spare / 2 : 0), y - size);
            y -= step;
        }
        y -= after;
    }
    function table(node, left, right) {
        const rows = Array.from(node.rows);
        if (!rows.length) return;
        const cols = Math.max(...rows.map(r => r.cells.length)), available = width - left - right;
        if (!cols) return;
        const tableSize = 9, step = 14, pad = 6;
        const data = rows.map(row => Array.from({ length: cols }, (_, i) => row.cells[i]
            ? collect(row.cells[i], { ...baseStyle, size: tableSize }) : []));
        // Prefer wider columns for longer contents, without starving small columns.
        const preferred = Array.from({ length: cols }, (_, i) => Math.max(40,
            ...data.map(row => Math.min(190, row[i].reduce((sum, g) => sum + g.width, 0) + pad * 2))));
        const minimum = Math.min(48, available / cols), extra = available - minimum * cols;
        const total = preferred.reduce((sum, w) => sum + w, 0);
        const widths = preferred.map(w => minimum + extra * w / total);
        const layouts = data.map(row => row.map((cell, i) => wrap(cell, Math.max(1, widths[i] - pad * 2))));
        const count = cells => Math.max(1, ...cells.map(lines => lines.length));
        const hasHeader = rows[0].parentElement.tagName === 'THEAD' || Array.from(rows[0].cells).every(c => c.tagName === 'TH');
        const headerCount = hasHeader ? count(layouts[0]) : 0;
        const headerHeight = headerCount * step + pad * 2;
        const maxLines = Math.floor((height - margin * 2 - pad * 2) / step);
        // Very tall headers are printed once; repeating them would leave no room for data.
        const repeatHeader = hasHeader && headerCount < maxLines / 3;
        function paintRow(index, start, n) {
            const rowHeight = n * step + pad * 2;
            let x = left;
            for (let col = 0; col < cols; col++) {
                page.drawRectangle({ x, y: y - rowHeight, width: widths[col], height: rowHeight,
                    color: index === 0 && hasHeader ? rgb(.91,.93,.95) : index % 2 ? rgb(.98,.985,.99) : rgb(1,1,1),
                    borderColor: border, borderWidth: .5 });
                const cell = rows[index].cells[col];
                const alignment = cell?.style.textAlign || 'left';
                for (let j = 0; j < n; j++) {
                    const line = layouts[index][col][start + j];
                    if (!line) continue;
                    const used = line.reduce((sum, g) => sum + g.width, 0), spare = widths[col] - pad * 2 - used;
                    // Repeated headers retain their native annotations at each printed occurrence.
                    drawLine(line, x + pad + (alignment === 'right' ? spare : alignment === 'center' ? spare / 2 : 0),
                        y - pad - tableSize - j * step);
                }
                x += widths[col];
            }
            y -= rowHeight;
        }
        function continueTable(index) {
            newPage();
            if (repeatHeader && index > 0) paintRow(0, 0, headerCount);
        }
        y -= 3;
        for (let index = 0; index < rows.length; index++) {
            let start = 0, remaining = count(layouts[index]);
            const fullHeight = remaining * step + pad * 2;
            const freshCapacity = height - margin * 2 - (repeatHeader && index > 0 ? headerHeight : 0);
            if (fullHeight <= freshCapacity && y - fullHeight < margin) continueTable(index);
            // Keep the header with at least the first line of the next row when possible.
            if (index === 0 && repeatHeader && rows.length > 1 && y - fullHeight - step - pad * 2 < margin) newPage();
            while (remaining > 0) {
                let capacity = Math.floor((y - margin - pad * 2) / step);
                if (capacity < 1) { continueTable(index); capacity = Math.floor((y - margin - pad * 2) / step); }
                const n = Math.min(remaining, capacity);
                paintRow(index, start, n);
                start += n; remaining -= n;
                if (remaining) continueTable(index);
            }
        }
        y -= 12;
    }
    async function diagram(figure, context) {
        const svg = figure.querySelector('.mermaid-diagram svg');
        const source = figure.querySelector('.mermaid-source');
        let rendered = false;
        if (svg) {
            try {
                // Rasterize the local SVG at print resolution; no network or SVG CDN is used.
                const box = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
                const svgWidth = box?.[2] || parseFloat(svg.getAttribute('width')) || 800;
                const svgHeight = box?.[3] || parseFloat(svg.getAttribute('height')) || 500;
                const available = width - context.left - context.right;
                const scale = Math.min(available / svgWidth, (height - margin * 2 - 12) / svgHeight);
                const drawWidth = svgWidth * scale, drawHeight = svgHeight * scale;
                const copy = svg.cloneNode(true);
                copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                copy.setAttribute('width', Math.ceil(drawWidth * 2));
                copy.setAttribute('height', Math.ceil(drawHeight * 2));
                copy.style.maxWidth = 'none';
                const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
                const image = await new Promise((resolve, reject) => {
                    const img = new Image();
                    const timeout = setTimeout(() => reject(new Error('Diagram image timed out')), 5000);
                    img.onload = () => { clearTimeout(timeout); resolve(img); };
                    img.onerror = () => { clearTimeout(timeout); reject(new Error('Diagram image could not be rendered')); };
                    img.src = url;
                });
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(drawWidth * 2); canvas.height = Math.ceil(drawHeight * 2);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas is unavailable');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                const png = await doc.embedPng(canvas.toDataURL('image/png'));
                ensure(drawHeight + 12);
                page.drawImage(png, { x: context.left + (available - drawWidth) / 2, y: y - drawHeight,
                    width: drawWidth, height: drawHeight });
                y -= drawHeight + 12; rendered = true;
            } catch (_) {
                // Keep the document useful when SVG/canvas rendering fails: print the source.
            }
        }
        if (source) {
            const sourceGlyphs = collect(source);
            const annotated = targets.some(({ range: r }) => r && r.start !== undefined && sourceGlyphs.some(g =>
                g.offset !== null && g.offset < Math.max(r.end, r.start + 1) && g.offset + g.sourceLength > r.start));
            if (!rendered || annotated) await render(source, context);
        }
    }
    async function render(node, context = { left: margin, right: margin, quote: false }) {
        if (node.nodeType === 3) {
            if (node.textContent.trim()) paragraph(collect(node), context);
            return;
        }
        if (node.nodeType !== 1 || node.matches('button, .mermaid-diagram, .mermaid-bar')) return;
        const { left, right } = context;
        if (node.matches('.mermaid-figure')) { await diagram(node, context); return; }
        if (node.tagName === 'TABLE') { table(node, left, right); return; }
        if (/^H[1-6]$/.test(node.tagName)) {
            const size = 24 - Number(node.tagName[1]) * 2;
            ensure(size * 1.5 + 30); y -= 8;
            paragraph(collect(node, { ...baseStyle, size, bold: true }), { ...context, size, after: 10 }); return;
        }
        if (node.tagName === 'PRE') {
            paragraph(collect(node, { ...baseStyle, size: 9, mono: true }, null, true),
                { ...context, size: 9, preserve: true, background: true }); return;
        }
        if (node.tagName === 'BLOCKQUOTE') {
            for (const child of node.childNodes) await render(child, { ...context, left: left + 8, quote: true });
            return;
        }
        if (node.matches('ul,ol')) {
            let number = Number(node.getAttribute('start') || 1);
            for (const item of Array.from(node.children).filter(c => c.tagName === 'LI')) {
                if (item.hasAttribute('value')) number = Number(item.getAttribute('value'));
                ensure(20);
                const label = node.tagName === 'OL' ? String(number++) + '.' : '•';
                drawLine(glyphs(label), left + 3, y - 11);
                const inline = Array.from(item.childNodes).filter(c => c.nodeType !== 1 || !c.matches('ul,ol,p,pre,table,blockquote'));
                if (inline.length) paragraph(inline.flatMap(c => collect(c)), { ...context, left: left + 23, after: 5 });
                for (const child of item.children) if (child.matches('ul,ol,p,pre,table,blockquote'))
                    await render(child, { ...context, left: left + 23 });
            }
            y -= 4; return;
        }
        if (node.tagName === 'HR') {
            ensure(14); page.drawLine({ start: { x: left, y: y - 5 }, end: { x: width - right, y: y - 5 },
                thickness: .8, color: border }); y -= 17; return;
        }
        if (node.matches('p')) { paragraph(collect(node), context); return; }
        for (const child of node.childNodes) await render(child, context);
    }
    await render(view);
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
        newPage();
        paragraph(glyphs('Annotations without a visible anchor', null, { ...baseStyle, size: 18, bold: true }), { size: 18 });
        for (const target of missing) { y -= 12; paragraph(glyphs(contents(target)), { preserve: true }); }
    }
    for (const [i, p] of doc.getPages().entries()) p.drawText(String(i + 1), {
        x: width - margin - 15, y: 25, size: 9, font, color: rgb(.4,.4,.4)
    });
    return doc.save();
};
