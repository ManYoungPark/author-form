// 원고(.docx / .pdf)에서 논문 제목·저자·감사의 글을 읽어 냄 — 새 논문 창의 [원고에서 불러오기].
// 파일은 브라우저 안에서만 읽고 어디에도 올리지 않는다.
// 브라우저에서는 window.JSZip / DOMParser / pdfjsLib 를 쓰고, Node 테스트에서는 deps 로 넘겨준다.
(function (global) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  // ── 1. 파일 → 문단(줄) 목록 ──
  async function docxParagraphs(bytes, deps = global) {
    const zip = await deps.JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new deps.DOMParser().parseFromString(xml, "application/xml");
    const out = [];
    for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
      let s = "";
      for (const n of Array.from(p.getElementsByTagNameNS(W, "*"))) {
        if (n.localName === "t") s += n.textContent;
        else if (n.localName === "tab") s += " ";
        else if (n.localName === "br") s += "\n";
      }
      s = s.replace(/\u00a0/g, " ").trim();
      if (s) out.push(s);
    }
    return out;
  }

  // PDF 는 글자 조각을 위치(y)로 묶어 줄을 만든 뒤, 이어지는 줄을 합쳐 문단으로 만듦 (최대 80쪽).
  // 원고 PDF 는 줄 간격이 넓어 간격만으로는 문단을 나눌 수 없으므로 글자 크기·끝 글자로 판단.
  const JOIN_WORDS = /\b(in|of|and|the|for|with|to|a|an|on|by|among|between|from|at|via|versus|vs\.?|or)$/i;
  async function pdfParagraphs(bytes, deps = global) {
    const pdf = await deps.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const lines = [];
    for (let pi = 0; pi < Math.min(pdf.numPages, 80); pi++) {
      const content = await (await pdf.getPage(pi + 1)).getTextContent();
      const pageLines = [];
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5], x = it.transform[4], h = Math.round((Math.abs(it.transform[3]) || 10) * 2) / 2;
        let line = pageLines.find((l) => Math.abs(l.y - y) < Math.max(l.h, h) * 0.6);
        if (!line) pageLines.push((line = { y, h, parts: [] }));
        line.parts.push({ x, w: it.width || 0, s: it.str, h, font: it.fontName });
        if (h > line.h) line.h = h; // 위첨자(작은 글자)는 줄 높이에 반영 안 됨
      }
      pageLines.sort((a, b) => b.y - a.y);
      for (const l of pageLines) {
        // 조각 사이가 붙어 있으면 공백 없이 이음 (한 단어가 여러 조각으로 나뉜 경우: "th" + "e")
        // 위첨자(소속 번호·기호)는 앞뒤를 띄움: "Park" + "a" → "Park a"
        let text = "", end = null, prevSup = false;
        for (const p of l.parts.sort((a, b) => a.x - b.x)) {
          const sup = p.h < l.h * 0.8;
          text += end !== null && (sup || prevSup || p.x - end > p.h * 0.15) ? " " + p.s : p.s;
          end = p.x + p.w;
          prevSup = sup;
        }
        const font = l.parts.filter((p) => p.h === l.h).map((p) => p.font)[0];
        text = text
          .replace(/\s+/g, " ").replace(/(\w) - (\w)/g, "$1-$2").replace(/\s+([,;:)])/g, "$1").trim();
        lines.push({ text, h: l.h, page: pi, font });
      }
    }
    // 본문 글꼴(가장 많이 쓰인 것) — 첫 쪽에서 본문과 다른 글꼴(굵은 제목 등)로 이어지는 줄은 한 문단
    const count = {};
    lines.forEach((l) => { count[l.font] = (count[l.font] || 0) + l.text.length; });
    const bodyFont = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const out = [];
    let cur = null;
    for (const l of lines) {
      const join = cur && cur.page === l.page && Math.abs(cur.h - l.h) < 0.6 &&
        // 소문자로 시작하면 이어지는 문장 — 단, "a Digital Health..." 처럼 소속 표시 글자 하나로 시작하는 줄은 새 문단
        (/[,;\-–&]$/.test(cur.text) || /^([a-z]{2}|\()/.test(l.text) || JOIN_WORDS.test(cur.text) ||
         (l.page === 0 && l.font === cur.font && l.font !== bodyFont && !/[.!?:]$/.test(cur.text)));
      if (join) cur.text += " " + l.text;
      else { if (cur) out.push(cur.text); cur = { ...l }; }
    }
    if (cur) out.push(cur.text);
    return out;
  }

  // ── 2. 문단 → 제목·저자·감사의 글 ──
  const HEADING_SKIP = /^(\[?title page\]?|original (article|research)|research article|review|manuscript|abstract)$/i;
  const ACK_HEAD = /^(funding( information| statement| sources?)?|financial support|acknowledge?ments?|감사의 ?글|연구비 지원)\s*:?\s*$/i;
  const ACK_INLINE = /^(funding( information| statement)?|acknowledge?ments?|감사의 ?글)\s*:\s*(.+)$/i;
  // 섹션 제목처럼 보이는 짧은 문단 (다음 섹션 시작)
  const looksHeading = (s) => s.length < 70 && !/[.。]$/.test(s) && /^[A-Z가-힣0-9]/.test(s) && s.split(/\s+/).length <= 8;

  const DEGREE = /^(ph\.?\s?d|m\.?d|k\.?m\.?d|o\.?m\.?d|m\.?s\.?c?|m\.?p\.?h|r\.?n|b\.?s\.?c?|m\.?a|b\.?a|mba|dds|pharm\.?\s?d|dr\.?p\.?h|sc\.?d|dvm|prof\.?|dr\.?)$/i;
  function splitAuthors(line) {
    // "Man Young Park 1,*, Young-Ju Jeon 1" / "Man Young Park, PhD1; Ji Yeon Lee, KMD, PhD2,*,†" / "Park a, Kim a f"
    const tokens = line.replace(/^authors?\s*:\s*/i, "").replace(/\s+(and|&)\s+/gi, ", ").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const list = [];
    for (const tok of tokens) {
      const name = tok.replace(/[\d*†‡§¶#✉^]+/g, " ").replace(/(\s+[a-z])+\s*$/, "").replace(/\s+/g, " ").trim();
      const marks = tok.replace(/[^*†‡§¶#✉]/g, "");
      if (!/[A-Za-z가-힣]{2}/.test(name) || DEGREE.test(name.replace(/\s/g, ""))) {
        // "1,*" 나 "PhD" 처럼 앞 이름에 붙는 조각
        if (list.length) list[list.length - 1].marks += marks;
        continue;
      }
      list.push({ name, marks });
    }
    return list;
  }

  const looksLikeAuthorLine = (s) => {
    if (s.length > 400 || /[.:]\s*$/.test(s) || /^(abstract|background|keywords?)/i.test(s)) return false;
    const parts = s.replace(/\s+(and|&)\s+/gi, ", ").split(/[,;]/).map((x) => x.replace(/[\d*†‡]/g, "").replace(/(\s+[a-z])+\s*$/, "").trim())
      .filter((x) => /[A-Za-z]{2}/.test(x) && !DEGREE.test(x.replace(/\s/g, "")));
    return parts.length >= 1 && parts.every((x) => /^([A-Z][a-zA-Z'’\-]*\.?\s*){2,4}$/.test(x));
  };

  function parseManuscript(paras) {
    const res = { title: "", authors: [], ack: "", acks: [], emails: {} };

    // 제목
    const tl = paras.find((p) => /^title\s*:/i.test(p));
    if (tl) res.title = tl.replace(/^title\s*:\s*/i, "");
    else res.title = paras.find((p) => !HEADING_SKIP.test(p.replace(/[\[\]]/g, "").trim()) && p.length > 8 && p.length < 400
      && !/^(running|short) title/i.test(p) && !/doi|issn|vol\.|https?:|©|copyright|\d{4};\d+/i.test(p)) || "";
    const titleIdx = paras.indexOf(tl || res.title);

    // 저자
    let al = paras.find((p) => /^authors?\s*:/i.test(p));
    if (!al) al = paras.slice(titleIdx + 1, titleIdx + 6).find(looksLikeAuthorLine);
    const raw = al ? splitAuthors(al) : [];
    // 기호 뜻: 원고의 설명 줄("* These authors contributed equally", "† Correspondence to")이 있으면 그걸 따름
    let corrMarks = "*✉", equalMarks = "†";
    for (const p of paras.slice(0, 40)) {
      const m = p.match(/^([*†‡§¶#])\s*(.*)/);
      if (!m) continue;
      if (/equal/i.test(m[2])) { equalMarks = m[1]; corrMarks = corrMarks.replace(m[1], ""); }
      else if (/correspond/i.test(m[2])) corrMarks = m[1] + corrMarks.replace(m[1], "");
    }
    res.authors = raw.map((a) => ({ name: a.name, corresponding: [...a.marks].some((c) => corrMarks.includes(c)),
      equal: [...a.marks].some((c) => equalMarks.includes(c)) }));
    // 공동 기여 표시는 첫 저자에게 있을 때만 '공동 제1저자'로 봄 (마지막 저자들의 공동 기여는 무시)
    if (!res.authors[0]?.equal) res.authors.forEach((a) => { a.equal = false; });
    // 교신저자 안내 줄 근처에 이름이 나오면 교신저자로 표시
    const ci = paras.findIndex((p) => /correspond(ing author|ence)/i.test(p));
    if (ci >= 0) {
      // 안내 줄에 이름이 있으면 그 줄만("*Corresponding author: Man Young Park, ..."),
      // "Correspondence to:" 처럼 비어 있으면 다음 문단들 (이메일·ORCID·Abstract 전까지)
      let near = paras[ci].replace(/^.*?correspond(ing authors?|ence)( at| to)?\s*[:：]?\s*/i, "");
      if (!near.trim()) {
        for (const p of paras.slice(ci + 1, ci + 8)) {
          if (/^(e-?mail|author orcid|orcid|abstract|keywords?|word count)/i.test(p)) break;
          near += " " + p;
        }
      }
      res.authors.forEach((a) => { if (a.name.length > 4 && near.includes(a.name)) a.corresponding = true; });
    }
    // 이메일: "Email addresses: Man Young Park: a@b; Young-Ju Jeon: c@d" → 이름별 이메일 (DB 매칭에 사용)
    for (const p of paras.slice(0, 40)) {
      for (const m of p.matchAll(/([A-Z][A-Za-z.'’\- ]{2,40}?)\s*[:：(]\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g)) res.emails[norm(m[1].replace(/^.*addresses?\s*/i, ""))] = m[2].toLowerCase();
    }
    res.authors.forEach((a) => { a.email = res.emails[norm(a.name)] || null; });
    res.top = paras.slice(0, 20); // 저자를 못 찾았을 때 DB 이름으로 찾아보는 데 씀

    // 감사의 글: Funding 섹션 우선, 그다음 Acknowledgements
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      const inline = p.match(ACK_INLINE);
      if (inline && inline[3].length > 20) { res.acks.push({ head: inline[1], text: inline[3].trim() }); continue; }
      if (!ACK_HEAD.test(p)) continue;
      const body = [];
      for (let j = i + 1; j < paras.length && body.length < 6; j++) {
        if (ACK_HEAD.test(paras[j]) || (looksHeading(paras[j]) && body.length)) break;
        body.push(paras[j]);
      }
      if (body.length) res.acks.push({ head: p.replace(/\s*:\s*$/, ""), text: body.join(" ").trim() });
    }
    const funding = res.acks.find((a) => /fund|financial|연구비/i.test(a.head));
    res.ack = (funding || res.acks[0] || {}).text || "";
    return res;
  }

  // ── 3. 영문 이름 → 저자 DB ──
  // 대소문자·하이픈·마침표·공백 무시, "Park Man Young" 처럼 성이 앞에 와도 같은 사람으로 봄
  function norm(s) { return (s || "").toLowerCase().replace(/[^a-z가-힣]/g, ""); }
  function nameKeys(s) {
    const words = (s || "").toLowerCase().replace(/[.\-‐–]/g, " ").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const keys = [words.join("")];
    if (words.length > 1) keys.push(words.slice(-1).concat(words.slice(0, -1)).join(""), words.slice(1).concat(words[0]).join(""));
    return keys;
  }
  function matchAuthor(parsed, dbAuthors) {
    if (parsed.email) {
      const byMail = dbAuthors.find((a) => a.email && a.email.toLowerCase() === parsed.email);
      if (byMail) return byMail;
    }
    const keys = new Set(nameKeys(parsed.name));
    const hits = dbAuthors.filter((a) => nameKeys(a.name_en).some((k) => keys.has(k)) || norm(a.name_kr) === norm(parsed.name));
    return hits.length === 1 ? hits[0] : null; // 동명이인이면 자동 연결하지 않음
  }

  // 저자 줄을 못 찾은 경우(출판된 PDF 등): 첫 부분에 DB 저자 이름(한글·영문)이 나오는 순서대로 추정
  function guessAuthorsFromDb(top, dbAuthors) {
    const text = top.join("\n");
    const flat = text.toLowerCase().replace(/[^a-z가-힣]/g, "");
    const hits = [];
    for (const a of dbAuthors) {
      const pos = [a.name_kr && text.indexOf(a.name_kr), ...nameKeys(a.name_en).map((k) => k.length > 6 && flat.indexOf(k))]
        .filter((i) => typeof i === "number" && i >= 0);
      if (pos.length) hits.push({ a, pos: Math.min(...pos) });
    }
    return hits.sort((x, y) => x.pos - y.pos).map((h) => h.a);
  }

  async function readManuscript(file, deps = global) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = /\.pdf$/i.test(file.name) || bytes[0] === 0x25; // %PDF
    const paras = isPdf ? await pdfParagraphs(bytes, deps) : await docxParagraphs(bytes, deps);
    return { ...parseManuscript(paras), source: isPdf ? "pdf" : "docx" };
  }

  const api = { docxParagraphs, pdfParagraphs, parseManuscript, matchAuthor, guessAuthorsFromDb, readManuscript };
  global.ManuscriptParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
