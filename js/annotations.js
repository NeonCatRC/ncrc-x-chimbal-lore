/* annotations.js — window.Anno
 *
 * Каркас-независимые помощники архива: палитра подсветок, чистка HTML статьи
 * (clean) и наложение пометок на готовый HTML (applyAnnos) через DOMParser.
 * React тут не нужен — это чистые операции над строками/DOM. Логика состояния
 * (хранение, localStorage, попапы) живёт в js/archive.jsx.
 */
window.Anno = (function () {
  const PALETTE = [
    { key: "yellow", title: "Жёлтый", mark: "rgba(255,214,90,0.55)", solid: "#eab308", text: "#3a2c05" },
    { key: "green", title: "Зелёный", mark: "rgba(120,210,130,0.5)", solid: "#3fae57", text: "#0f3d1c" },
    { key: "pink", title: "Розовый", mark: "rgba(255,150,195,0.5)", solid: "#e8649a", text: "#4d1530" },
    { key: "blue", title: "Голубой", mark: "rgba(125,185,255,0.52)", solid: "#4f93e0", text: "#102d4d" }
  ];

  function pal(key) { return PALETTE.find((p) => p.key === key) || PALETTE[0]; }
  function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  // ── чистка HTML статьи ─────────────────────────────────────
  function clean(html, folder) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    body.querySelectorAll('script,style,noscript,iframe,h4,#video-container,[id^="yandex_rtb"],.pip-mat-inner,.ad-sticly__parent').forEach((n) => n.remove());
    body.querySelectorAll("h1").forEach((n) => n.remove());
    body.querySelectorAll(".meta").forEach((n) => n.remove());
    body.querySelectorAll("p").forEach((p) => {
      const a = p.querySelector('a[href*="index.html"]');
      if (a && p.textContent.trim().length < 40) p.remove();
    });
    const tw = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT, null);
    const comments = [];
    while (tw.nextNode()) comments.push(tw.currentNode);
    comments.forEach((n) => n.remove());

    body.querySelectorAll("img").forEach((img) => {
      let src = img.getAttribute("src") || "";
      if (src && !/^https?:|^data:|^\//.test(src)) src = "data/articles/" + folder + "/" + src;
      img.setAttribute("src", src);
      img.setAttribute("loading", "lazy");
      img.setAttribute("style", "display:block;max-width:100%;height:auto;margin:18px auto;border-radius:8px;box-shadow:0 2px 16px -7px rgba(0,0,0,0.45);");
      img.setAttribute("onerror", "this.style.opacity='0.25';this.style.minHeight='0';");
    });
    body.querySelectorAll("a").forEach((a) => {
      const dl = a.getAttribute("data-link");
      if (dl) a.setAttribute("href", dl);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
      a.setAttribute("style", "color:#9d4b35;text-decoration:underline;text-underline-offset:2px;");
    });
    body.querySelectorAll("p").forEach((p) => p.setAttribute("style", "margin:0 0 1.15em;"));
    body.querySelectorAll("h2").forEach((h) => h.setAttribute("style", "margin:1.8em 0 .5em;font-family:'Lora',Georgia,serif;font-weight:600;font-size:27px;color:#2a2622;letter-spacing:-0.01em;line-height:1.25;"));
    body.querySelectorAll("h3").forEach((h) => h.setAttribute("style", "margin:1.5em 0 .4em;font-family:'Lora',Georgia,serif;font-weight:600;font-size:21px;color:#2a2622;"));
    body.querySelectorAll("blockquote").forEach((b) => b.setAttribute("style", "margin:1.5em 0;padding:.15em 0 .15em 22px;border-left:3px solid #c9a394;font-style:italic;color:#6b6253;font-size:20px;line-height:1.6;"));
    body.querySelectorAll("table").forEach((t) => t.setAttribute("style", "width:100%;border-collapse:collapse;margin:18px 0;"));
    body.querySelectorAll("td,th").forEach((td) => td.setAttribute("style", "padding:4px;vertical-align:top;"));
    body.querySelectorAll("p").forEach((p) => { if (!p.textContent.trim() && !p.querySelector("img")) p.remove(); });

    const text = body.textContent || "";
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return { html: body.innerHTML, text, words, title: null, date: null };
  }

  // ── геометрия выделений ────────────────────────────────────
  function offsetIn(root, node, off) {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, off);
    return r.toString().length;
  }

  function collectTextNodes(root) {
    const out = []; let pos = 0;
    const walk = (n) => {
      if (n.nodeType === 3) { out.push({ node: n, start: pos, end: pos + n.nodeValue.length }); pos += n.nodeValue.length; }
      else if (n.nodeType === 1 && !(n.hasAttribute && n.hasAttribute("data-anno-ui"))) {
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      }
    };
    walk(root);
    return out;
  }

  function markStyleStr(p, hasNote) {
    let s = "background:" + p.mark + ";border-radius:2px;cursor:pointer;";
    if (hasNote) s += "text-decoration:underline dotted " + p.solid + ";text-underline-offset:3px;";
    return s;
  }
  function badgeStyleStr(p) {
    return "display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;margin:0 2px;border-radius:8px;background:" + p.solid + ";color:#fff;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;vertical-align:super;cursor:pointer;box-shadow:0 1px 4px -1px rgba(0,0,0,0.4);";
  }

  function rangesOf(a) { return (a.ranges && a.ranges.length) ? a.ranges : [{ start: a.start, end: a.end }]; }
  function firstStart(a) { return rangesOf(a).reduce((m, r) => Math.min(m, r.start), Infinity); }

  function wrapOneRange(root, doc, anno, rg) {
    const p = pal(anno.color);
    const tns = collectTextNodes(root);
    let lastMark = null;
    for (const t of tns) {
      if (t.end <= rg.start || t.start >= rg.end) continue;
      const a = Math.max(rg.start, t.start) - t.start, b = Math.min(rg.end, t.end) - t.start;
      const node = t.node, text = node.nodeValue;
      const before = text.slice(0, a), mid = text.slice(a, b), after = text.slice(b);
      if (!mid) continue;
      const mark = doc.createElement("mark");
      mark.setAttribute("data-anno", anno.id);
      mark.setAttribute("class", "anno-hl");
      mark.setAttribute("style", markStyleStr(p, anno.note != null));
      mark.textContent = mid;
      const frag = doc.createDocumentFragment();
      if (before) frag.appendChild(doc.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(doc.createTextNode(after));
      node.parentNode.replaceChild(frag, node);
      lastMark = mark;
    }
    return lastMark;
  }

  function insertBadge(doc, mark, anno, n) {
    const p = pal(anno.color);
    const badge = doc.createElement("span");
    badge.setAttribute("data-anno-ui", "1");
    badge.setAttribute("data-anno-note", anno.id);
    badge.setAttribute("class", "anno-badge");
    badge.setAttribute("data-n", String(n));
    badge.setAttribute("style", badgeStyleStr(p));
    mark.parentNode.insertBefore(badge, mark.nextSibling);
  }

  function applyAnnos(html, annos) {
    const doc = new DOMParser().parseFromString("<div id='annoroot'>" + html + "</div>", "text/html");
    const root = doc.getElementById("annoroot");
    const noteAnnos = annos.filter((a) => a.note != null).sort((a, b) => firstStart(a) - firstStart(b));
    const numById = {}; noteAnnos.forEach((a, i) => { numById[a.id] = i + 1; });
    const pairs = [];
    annos.forEach((a) => rangesOf(a).forEach((rg) => pairs.push({ a, rg })));
    pairs.sort((x, y) => y.rg.start - x.rg.start);
    const badgeAnchor = {};
    for (const pr of pairs) {
      const mark = wrapOneRange(root, doc, pr.a, pr.rg);
      if (mark && badgeAnchor[pr.a.id] === undefined) badgeAnchor[pr.a.id] = mark;
    }
    for (const a of annos) {
      if (a.note != null && badgeAnchor[a.id]) insertBadge(doc, badgeAnchor[a.id], a, numById[a.id]);
    }
    return root.innerHTML;
  }

  return {
    PALETTE, pal, uid, clean,
    offsetIn, collectTextNodes, rangesOf, firstStart, applyAnnos
  };
})();
