/* Relay Trip Analyzer - Word (.docx) writer.
 *
 * Builds a real Office Open XML document from "blocks" (the same blocks
 * core.parseReportText makes from the summary text, plus image blocks), with
 * tables, coloured TRIP / No trip / CHECK text, page numbers and embedded PNG
 * pictures. Writes the zip itself (stored, no compression), so it has no
 * dependencies and works in browsers and Node.
 *
 *   SELDocx.build(blocks, { title, footer }) -> Uint8Array (.docx bytes)
 *
 * Block kinds: title, meta, h1, h2, sub, para, note, bullets, mono, kv, table,
 * image {png: Uint8Array, width, height (px), caption}.
 */
(function (root) {
"use strict";

// ---------------------------------------------------------------------------
// zip (store method)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const enc = (s) => new TextEncoder().encode(s);

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const [name, data] of files) {
    const nm = enc(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// WordprocessingML helpers
// ---------------------------------------------------------------------------
const X = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const COLORS = { ink: "1B1B1B", muted: "666666", accent: "0B5CAD", rule: "D6DCE4", head: "EAF1FA", band: "F7F9FC",
                 trip: "C42B1C", ok: "0F7B0F", warn: "A15C00" };
const MARGIN = 1152;                       // twips (0.8in margins)
const PAPER = { letter: [12240, 15840], a4: [11906, 16838] };
let PAGE_W = PAPER.letter[0], PAGE_H = PAPER.letter[1], CONTENT_W = PAGE_W - 2 * MARGIN;

function run(text, o) {
  o = o || {};
  const pr = [];
  if (o.font) pr.push(`<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>`);
  if (o.bold) pr.push("<w:b/>");
  if (o.italic) pr.push("<w:i/>");
  if (o.color) pr.push(`<w:color w:val="${o.color}"/>`);
  if (o.size) pr.push(`<w:sz w:val="${Math.round(o.size * 2)}"/><w:szCs w:val="${Math.round(o.size * 2)}"/>`);
  const lines = String(text).split("\n");
  return lines.map((ln, i) => `<w:r>${pr.length ? `<w:rPr>${pr.join("")}</w:rPr>` : ""}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${X(ln)}</w:t></w:r>`).join("");
}
function para(content, o) {
  o = o || {};
  const pr = [];
  if (o.style) pr.push(`<w:pStyle w:val="${o.style}"/>`);
  if (o.keepNext) pr.push("<w:keepNext/>");
  if (o.after !== undefined || o.before !== undefined) pr.push(`<w:spacing w:before="${o.before || 0}" w:after="${o.after !== undefined ? o.after : 80}"/>`);
  if (o.ind) pr.push(`<w:ind w:left="${o.ind}" w:hanging="${o.hanging || 0}"/>`);
  if (o.align) pr.push(`<w:jc w:val="${o.align}"/>`);
  return `<w:p>${pr.length ? `<w:pPr>${pr.join("")}</w:pPr>` : ""}${content}</w:p>`;
}
const RUN_COLOR = { trip: COLORS.trip, ok: COLORS.ok, warn: COLORS.warn };
function runs(list, base) {
  return list.map(([t, col]) => run(t, Object.assign({}, base || {}, col ? { bold: true, color: RUN_COLOR[col] || col } : {}))).join("");
}

function table(headers, rows, widthsPct, o) {
  o = o || {};
  const widths = widthsPct.map((p) => Math.round((CONTENT_W * p) / 100));
  const border = (side, on) => `<w:${side} w:val="${on ? "single" : "nil"}" w:sz="4" w:space="0" w:color="${COLORS.rule}"/>`;
  const tblPr = `<w:tblPr><w:tblW w:w="${CONTENT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${border("top", true)}${border("left", false)}${border("bottom", true)}${border("right", false)}${border("insideH", true)}${border("insideV", false)}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  const cell = (content, w, fill) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${content}</w:tc>`;
  const keep = rows.length <= 18;
  const out = [];
  if (headers) {
    out.push(`<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headers.map((h, j) =>
      cell(para(run(h, { bold: true, color: COLORS.accent, size: 9 }), { after: 0, keepNext: true }), widths[j], COLORS.head)).join("")}</w:tr>`);
  }
  rows.forEach((r, i) => {
    out.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, j) => {
      const content = Array.isArray(v) ? runs(v, { size: 9, font: o.monoCols && o.monoCols.includes(j) ? "Consolas" : undefined })
        : run(v, { size: 9, bold: o.boldFirst && j === 0, color: o.boldFirst && j === 0 ? COLORS.muted : undefined,
                   font: o.monoCols && o.monoCols.includes(j) ? "Consolas" : undefined });
      return cell(para(content, { after: 0, keepNext: keep && i < rows.length - 1 }), widths[j], o.band && i % 2 ? COLORS.band : null);
    }).join("")}</w:tr>`);
  });
  return `<w:tbl>${tblPr}${grid}${out.join("")}</w:tbl>` + para("", { after: 60 });
}

function image(rid, id, wpx, hpx, maxIn) {
  const maxW = Math.min((maxIn || 6.9) * 914400, (CONTENT_W / 1440) * 914400);
  let cx = wpx * 9525, cy = hpx * 9525;          // 96 dpi
  if (cx > maxW) { cy = Math.round((cy * maxW) / cx); cx = maxW; }
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="${COLORS.ink}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${COLORS.accent}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="${COLORS.muted}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

/** blocks -> .docx bytes */
function build(blocks, opts) {
  opts = opts || {};
  [PAGE_W, PAGE_H] = PAPER[(opts.paper || "letter").toLowerCase()] || PAPER.letter;
  CONTENT_W = PAGE_W - 2 * MARGIN;
  const body = [], media = [];
  let imgId = 1;
  for (const blk of blocks) {
    const kind = blk[0];
    if (kind === "title") body.push(para(run(blk[1]), { style: "Title" }));
    else if (kind === "meta") body.push(para(run(blk[1].join("    "), { size: 8.5, color: COLORS.muted }), { after: 200 }));
    else if (kind === "h1") body.push(para(run(blk[1]), { style: "Heading1" }));
    else if (kind === "h2") body.push(para(run(blk[1]), { style: "Heading2" }));
    else if (kind === "sub") body.push(para(run(blk[1]), { style: "Heading3" }));
    else if (kind === "para") body.push(para(run(blk[1])));
    else if (kind === "note") body.push(para(run(blk[1], { italic: true, size: 8.5, color: COLORS.muted })));
    else if (kind === "bullets") {
      for (const b of blk[1]) body.push(para(run("•  ", { color: COLORS.muted }) + runs(blk.runs ? blk.runs(b) : opts.runs ? opts.runs(b) : [[b, null]]),
                                             { ind: 360, hanging: 220, after: 40 }));
      body.push(para("", { after: 40 }));
    } else if (kind === "mono") body.push(para(run(blk[1].join("\n"), { font: "Consolas", size: 8 })));
    else if (kind === "kv") body.push(table(null, blk[1].map(([k, v, mono]) => [k, v]), [22, 78],
                                            { boldFirst: true, monoCols: blk[1].some((x) => x[2]) ? [0, 1] : [] }));
    else if (kind === "table") {
      const [, headers, rows] = blk;
      const widths = headers[0] === "#" ? [5, 21, 15, 8, 51] : headers[0] === "Cycle" ? [10, 16, 26, 48] : blk[3] || headers.map(() => 100 / headers.length);
      const causeCol = headers.indexOf("Cause");
      const rr = rows.map((r) => r.map((v, j) => (j === causeCol && opts.runs ? opts.runs(v) : v)));
      body.push(table(headers, rr, widths, { band: true, monoCols: headers[0] === "Cycle" ? [0, 1] : [] }));
    } else if (kind === "image") {
      const { png, width, height, caption } = blk[1];
      const rid = `rIdImg${imgId}`;
      media.push([`word/media/image${imgId}.png`, png, rid]);
      body.push(para(image(rid, imgId, width, height, blk[1].maxInches), { after: caption ? 20 : 120, align: "center" }));
      if (caption) body.push(para(run(caption, { italic: true, size: 8.5, color: COLORS.muted }), { after: 160, align: "center" }));
      imgId++;
    }
  }
  const footerText = opts.footer || "Relay Trip Analyzer";
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>` +
    `<w:pgMar w:top="1008" w:right="${MARGIN}" w:bottom="1008" w:left="${MARGIN}" w:header="576" w:footer="576" w:gutter="0"/></w:sectPr>`;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;
  const fld = (instr) => `<w:fldSimple w:instr=" ${instr} "><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>` +
    para(run(`${footerText}    Page `, { size: 8, color: COLORS.muted }) + fld("PAGE") + run(" of ", { size: 8, color: COLORS.muted }) + fld("NUMPAGES"), { align: "right", after: 0 }) +
    `</w:ftr>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
    media.map(([path, , rid]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${path.replace("word/", "")}"/>`).join("") +
    `</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${X(opts.title || "Relay Trip Event Summary")}</dc:title><dc:creator>Relay Trip Analyzer</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  return zip([
    ["[Content_Types].xml", enc(types)], ["_rels/.rels", enc(pkgRels)], ["docProps/core.xml", enc(coreXml)],
    ["word/document.xml", enc(doc)], ["word/styles.xml", enc(STYLES)], ["word/footer1.xml", enc(footer)],
    ["word/_rels/document.xml.rels", enc(rels)],
  ].concat(media.map(([p, data]) => [p, data])));
}

const api = { build, zip, crc32 };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELDocx = api;
})(typeof window !== "undefined" ? window : globalThis);
