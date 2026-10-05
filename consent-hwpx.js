// KIOM 논문 저자 동의서(HWPX) 생성 — academic-paper-toolkit/scripts/generate_agreement.py 의 브라우저 버전.
// 템플릿(zip 안의 XML)에 논문·저자 정보를 채우고 서명 이미지를 넣어 다시 묶는다.
// 브라우저에서는 window.JSZip / DOMParser 를 쓰고, Node 테스트에서는 deps 로 넘겨준다.
(function (global) {
  const HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
  const HC = "http://www.hancom.co.kr/hwpml/2011/core";
  const XMLNS = "http://www.w3.org/2000/xmlns/";
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  const MAX_AUTHOR_ROWS = 8; // 템플릿 1페이지 저자 표 줄 수

  // 직계 자식 중 HP 네임스페이스의 tag 요소들 (ElementTree 의 findall("hp:tag"))
  const kids = (el, tag) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === HP && n.localName === tag);
  // 모든 자손 (ElementTree 의 iter / findall(".//hp:tag"))
  const desc = (el, tag) => Array.from(el.getElementsByTagNameNS(HP, tag));

  // 셀 안의 글자칸에 값을 넣음 (첫 칸에 넣고 나머지는 비움).
  // 템플릿의 아래쪽 저자 줄은 글자칸(hp:t)이 아예 없는 빈 셀이라 없으면 만들어 넣음.
  function setCellText(cell, text) {
    const ts = desc(cell, "t");
    if (!ts.length) {
      const run = desc(cell, "run")[0];
      if (!run) return;
      const t = run.ownerDocument.createElementNS(HP, "hp:t");
      run.appendChild(t);
      ts.push(t);
    }
    ts.forEach((t, i) => { t.textContent = i === 0 ? text : ""; });
  }

  // 셀 글자 모양(문단·글자 스타일)을 기준 셀과 같게 맞춤
  function copyCellStyle(from, to) {
    const fp = desc(from, "p")[0], tp = desc(to, "p")[0];
    const fr = fp && kids(fp, "run")[0], tr = tp && kids(tp, "run")[0];
    if (fp && tp) tp.setAttribute("paraPrIDRef", fp.getAttribute("paraPrIDRef"));
    if (fr && tr) tr.setAttribute("charPrIDRef", fr.getAttribute("charPrIDRef"));
  }

  function createPic(doc, picId, imgRef, width, height) {
    const el = (ns, tag, attrs = {}, parent) => {
      const e = doc.createElementNS(ns, (ns === HP ? "hp:" : "hc:") + tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (parent) parent.appendChild(e);
      return e;
    };
    const pic = el(HP, "pic", {
      id: picId, zOrder: 10, numberingType: "PICTURE", textWrap: "TOP_AND_BOTTOM", textFlow: "BOTH_SIDES",
      lock: 0, dropcapstyle: "None", href: "", groupLevel: 0, instid: picId + 1000, reverse: 0,
    });
    el(HP, "offset", { x: 0, y: 0 }, pic);
    el(HP, "orgSz", { width, height }, pic);
    el(HP, "curSz", { width, height }, pic);
    el(HP, "flip", { horizontal: 0, vertical: 0 }, pic);
    el(HP, "rotationInfo", { angle: 0, centerX: Math.floor(width / 2), centerY: Math.floor(height / 2), rotateimage: 1 }, pic);
    const rinfo = el(HP, "renderingInfo", {}, pic);
    const ident = { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 };
    for (const m of ["transMatrix", "scaMatrix", "rotMatrix"]) el(HC, m, ident, rinfo);
    const rect = el(HP, "imgRect", {}, pic);
    el(HC, "pt0", { x: 0, y: 0 }, rect);
    el(HC, "pt1", { x: width, y: 0 }, rect);
    el(HC, "pt2", { x: width, y: height }, rect);
    el(HC, "pt3", { x: 0, y: height }, rect);
    el(HP, "imgClip", { left: 0, right: width, top: 0, bottom: height }, pic);
    el(HP, "inMargin", { left: 0, right: 0, top: 0, bottom: 0 }, pic);
    el(HP, "imgDim", { dimwidth: width, dimheight: height }, pic);
    el(HC, "img", { binaryItemIDRef: imgRef, bright: 0, contrast: 0, effect: "REAL_PIC", alpha: 0 }, pic);
    el(HP, "effects", {}, pic);
    el(HP, "sz", { width, widthRelTo: "ABSOLUTE", height, heightRelTo: "ABSOLUTE", protect: 0 }, pic);
    el(HP, "pos", {
      treatAsChar: 1, affectLSpacing: 0, flowWithText: 1, allowOverlap: 0, holdAnchorAndSO: 0,
      vertRelTo: "PARA", horzRelTo: "PARA", vertAlign: "TOP", horzAlign: "LEFT", vertOffset: 0, horzOffset: 0,
    }, pic);
    el(HP, "outMargin", { left: 0, right: 0, top: 0, bottom: 0 }, pic);
    return pic;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
  }

  /**
   * @param {ArrayBuffer|Uint8Array} templateBytes  templates/consent_template.hwpx
   * @param {{title, journal, ack, date?}} info
   * @param {Array<{name, role_type, role_desc, affiliation, internal, project_participant, signature?: {bytes, ext}}>} authors
   * @param {{JSZip, DOMParser, XMLSerializer}} [deps]
   * @returns {Promise<Uint8Array>} .hwpx 파일 내용
   */
  async function buildConsentHwpx(templateBytes, info, authors, deps = global) {
    const { JSZip, DOMParser, XMLSerializer } = deps;
    const title = info.title || "", journal = info.journal || "", ack = info.ack || "";
    const date = info.date || todayStr();

    const zin = await JSZip.loadAsync(templateBytes);
    const names = Object.keys(zin.files).filter((n) => !zin.files[n].dir);
    const files = {};
    for (const n of names) files[n] = await zin.files[n].async("uint8array");
    // 템플릿에서 무압축으로 저장된 파일들 (한글이 저장한 방식 그대로 유지)
    const stored = new Set(["mimetype", "version.xml", "Preview/PrvImage.png"]);
    const dec = new TextDecoder(), enc = new TextEncoder();

    // 1. 서명 이미지를 BinData 와 content.hpf 목록에 등록
    let hpf = dec.decode(files["Contents/content.hpf"]);
    const sigRef = new Map(); // author index -> binaryItemIDRef
    let imgNum = 10;
    authors.forEach((a, i) => {
      if (!a.signature) return;
      const id = `sig_img_${imgNum++}`;
      const ext = a.signature.ext;
      const mime = ext === ".png" ? "image/png" : ext === ".bmp" ? "image/bmp" : "image/jpeg";
      const path = `BinData/${id}${ext}`;
      files[path] = a.signature.bytes;
      hpf = hpf.replace("</opf:manifest>", `  <opf:item id="${id}" href="${path}" media-type="${mime}" isEmbeded="1"/>\n  </opf:manifest>`);
      sigRef.set(i, id);
    });
    files["Contents/content.hpf"] = enc.encode(hpf);

    // 2. 본문 XML
    const doc = new DOMParser().parseFromString(dec.decode(files["Contents/section0.xml"]), "application/xml");
    const root = doc.documentElement;
    root.setAttributeNS(XMLNS, "xmlns:hc", HC);
    const children = Array.from(root.childNodes).filter((n) => n.nodeType === 1);
    const headerP = children[5].cloneNode(true);       // 별지 제3호 서식 머리말
    const consentTblP = children[6].cloneNode(true);   // 전자서명 사용 동의서 표
    while (root.firstChild) root.removeChild(root.firstChild);
    children.slice(0, 5).forEach((c) => root.appendChild(c));

    // 3. 1페이지 표: 논문명·저널명·감사의 글 (0번 칸은 제목 라벨, 1번 칸이 내용)
    const tbl0 = desc(root, "tbl")[0];
    const rows = kids(tbl0, "tr");
    [[1, title], [2, journal], [3, ack]].forEach(([r, v]) => {
      const cells = kids(rows[r], "tc");
      if (cells.length > 1) setCellText(cells[1], v);
    });
    const internal = authors.filter((a) => a.internal !== false).length;
    desc(rows[5], "t").forEach((t) => {
      if (t.textContent.includes("논문 저자")) t.textContent = `논문 저자 (내부 :  ${internal} 명, 외부 :  ${authors.length - internal}명)`;
    });

    // 4. 저자 표 (7번 줄부터)
    let picId = 10001;
    const firstRowCells = kids(rows[7], "tc"); // 첫 저자 줄: 글자 모양 기준
    authors.forEach((a, idx) => {
      const r = 7 + idx;
      if (r >= rows.length) return;
      const cells = kids(rows[r], "tc");
      if (idx > 0) for (let c = 0; c < 5; c++) copyCellStyle(firstRowCells[c], cells[c]);
      setCellText(cells[0], a.role_type || "");
      setCellText(cells[1], a.affiliation || "");
      setCellText(cells[2], a.name);
      setCellText(cells[3], a.project_participant || "참여");
      setCellText(cells[4], a.role_desc || "");
      const p = desc(cells[5], "p")[0];
      if (!p) return;
      p.setAttribute("paraPrIDRef", "35"); // 가운데 정렬
      const run = kids(p, "run")[0];
      if (!run) return;
      kids(run, "t").forEach((t) => run.removeChild(t));
      if (sigRef.has(idx)) {
        run.appendChild(createPic(doc, picId++, sigRef.get(idx), 3600, 1800));
        run.appendChild(doc.createElementNS(HP, "hp:t"));
      } else {
        const t = doc.createElementNS(HP, "hp:t");
        t.textContent = `${a.name} (인)`;
        run.appendChild(t);
      }
    });

    // 5. 저자마다 전자서명 사용 동의서(별지 제3호 서식) 페이지
    authors.forEach((a, idx) => {
      const hP = headerP.cloneNode(true), tP = consentTblP.cloneNode(true);
      const tables = desc(tP, "tbl");
      if (tables[0]) {
        const trs = kids(tables[0], "tr");
        if (trs[1]) desc(trs[1], "t").forEach((t) => {
          if (t.textContent.includes("본인")) t.textContent = `본인 ${a.name}은 ‘논문 저자 동의서’에 활용되는 전자서명의 사용을 동의합니다.`;
        });
        if (trs[2]) {
          desc(trs[2], "t").forEach((t) => {
            const s = t.textContent;
            if (!s) return;
            if (s.includes("[작성일자]") || /20\d\d\./.test(s)) t.textContent = date;
            else if (s.includes("신청자")) t.textContent = `${" ".repeat(68)}신청자 :  ${a.name}   (인)`;
          });
          if (sigRef.has(idx)) {
            const ps = desc(kids(trs[2], "tc")[0], "p");
            if (ps.length) {
              const run = doc.createElementNS(HP, "hp:run");
              run.setAttribute("charPrIDRef", "26");
              run.appendChild(createPic(doc, picId++, sigRef.get(idx), 3600, 1800));
              ps[ps.length - 1].appendChild(run);
            }
          }
        }
      }
      if (tables[1]) {
        const trs = kids(tables[1], "tr");
        const p = trs[1] && desc(kids(trs[1], "tc")[0], "p")[0];
        if (p) {
          p.setAttribute("paraPrIDRef", "35");
          const run = kids(p, "run")[0];
          if (run) {
            kids(run, "t").forEach((t) => run.removeChild(t));
            if (sigRef.has(idx)) {
              run.appendChild(createPic(doc, picId++, sigRef.get(idx), 9000, 4500));
              run.appendChild(doc.createElementNS(HP, "hp:t"));
            } else {
              const t = doc.createElementNS(HP, "hp:t");
              t.textContent = `${a.name} (서명 미등록)`;
              run.appendChild(t);
            }
          }
        }
      }
      root.appendChild(hP);
      root.appendChild(tP);
    });

    // 6. 한컴 무결성 검사 통과를 위해 줄 배치 캐시(linesegarray) 제거 → 한글이 열 때 다시 계산
    desc(root, "linesegarray").forEach((n) => n.parentNode.removeChild(n));
    files["Contents/section0.xml"] = enc.encode(XML_DECL + new XMLSerializer().serializeToString(root));

    // 7. 미리보기 글자
    if (files["Preview/PrvText.txt"]) {
      let prv = dec.decode(files["Preview/PrvText.txt"]);
      prv = prv.replace(/<논 문 명><.*?>/, () => `<논 문 명><${title}>`)
        .replace(/<저 널 명><.*?>/, () => `<저 널 명><${journal}>`)
        .replace(/<감사의글 \(Acknowledgement\)><.*?>/s, () => `<감사의글 (Acknowledgement)><${ack}>`);
      files["Preview/PrvText.txt"] = enc.encode(prv);
    }

    // 8. 다시 묶기: mimetype 은 맨 앞·무압축 (KS X 6101), 나머지는 원래 압축 방식 유지
    const zout = new JSZip();
    const order = ["mimetype", ...names.filter((n) => n !== "mimetype"), ...Object.keys(files).filter((n) => !names.includes(n))];
    for (const n of order) {
      zout.file(n, files[n], { compression: n === "mimetype" || stored.has(n) ? "STORE" : "DEFLATE", createFolders: false });
    }
    return zout.generateAsync({ type: "uint8array", mimeType: "application/hwp+zip" });
  }

  global.buildConsentHwpx = buildConsentHwpx;
  global.CONSENT_MAX_AUTHORS = MAX_AUTHOR_ROWS;
  if (typeof module !== "undefined") module.exports = { buildConsentHwpx, MAX_AUTHOR_ROWS };
})(typeof window !== "undefined" ? window : globalThis);
