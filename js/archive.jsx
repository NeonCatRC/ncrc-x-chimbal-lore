/* archive.jsx — компонент Archive (само приложение-архив)
 *
 * Перенесено из монолитного <x-dc>+DCLogic на обычный React (UMD+Babel,
 * как лендинг). Класс-компонент: вся логика — методы и поля экземпляра,
 * разметка — JSX в render(). Каркас-независимые помощники вынесены в
 * window.Anno (js/annotations.js), фон — в window.Starfield (js/starfield.jsx).
 *
 * Статичные стили — классы .arc-* в css/styles.css. Инлайном остаются только
 * значения, зависящие от состояния (активный тег, выбранный пункт, позиция
 * тулбара/попапа, цвета палитры).
 */
const LANDING_URL = "https://neoncatrc.github.io/ncrc-x-chimbal/";
// admin-api для записи overlay (только в режиме редактора, обычно через SSH-туннель
// на 127.0.0.1). Переопределяется через window.CHIMBAL_ADMIN_API.
const ADMIN_API = (typeof window !== "undefined" && window.CHIMBAL_ADMIN_API) || "http://localhost:8090";

// Ловит ошибку рендера статьи, чтобы не падало всё приложение. key={id} в месте
// использования сбрасывает состояние при переключении статьи.
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("article render failed", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="arc-box-red">
          Не удалось отобразить статью (ошибка рендера).{" "}
          <a href={this.props.url || "#"} target="_blank" rel="noopener" style={{ color: "#9d4b35", fontWeight: 500 }}>Открыть оригинал ↗</a>
        </div>
      );
    }
    return this.props.children;
  }
}

class Archive extends React.Component {
  state = {
    query: "", activeTags: [], selectedId: null, tagMenuOpen: false,
    appLoading: true, loadErr: false, articleLoading: false, articleErr: false,
    adminMode: (typeof localStorage !== "undefined" && localStorage.getItem("chimbal.admin.v1") === "1"),
    gateOpen: !(typeof localStorage !== "undefined" && localStorage.getItem("chimbal.gate.v1") === "1"),
    toolbar: null, note: null, annoTick: 0, panelOpen: true,
    reqLoading: false, reqCount: null, reqDone: false, reqBusy: false, reviewTick: 0,
    reviewFilter: null   // null | "reviewed" | "pending"
  };

  articles = [];
  htmlCache = {};
  annoStore = {};
  fileAnnos = {};
  reviewStore = {};   // локальные override'ы статуса (localStorage + правки админа в сессии)
  fileReviews = {};   // закоммиченная карта { id: {reviewed, requestsAtReview} } из data/reviews.json
  currentSel = null;
  LIST_CAP = 90;

  // ---- list / filter ----
  setQuery = (e) => this.setState({ query: e.target.value });
  toggleTag = (tag) => this.setState((s) => ({
    activeTags: s.activeTags.includes(tag) ? s.activeTags.filter((t) => t !== tag) : [...s.activeTags, tag]
  }));
  clearFilters = () => this.setState({ query: "", activeTags: [], reviewFilter: null });
  setReviewFilter = (v) => this.setState((s) => ({ reviewFilter: s.reviewFilter === v ? null : v }));
  toggleTagMenu = () => this.setState((s) => ({ tagMenuOpen: !s.tagMenuOpen }));
  closeMenu = () => this.setState({ tagMenuOpen: false });

  select = (id) => {
    const a = this.articles.find((x) => x.id === id);
    this.setState({ selectedId: id, toolbar: null, note: null });
    this.currentSel = null;
    this.loadArticle(a);
    this.loadReview(a);
    if (this.mainEl) this.mainEl.scrollTop = 0;
  };

  // Теги и их счётчики постоянны после загрузки — считаем один раз, а не в render.
  computeTags() {
    const counts = {};
    this.articles.forEach((a) => (a.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    this.tagCounts = counts;
    this.allTags = Object.keys(counts).sort((x, y) => counts[y] - counts[x] || x.localeCompare(y, "ru"));
  }

  // ---- data ----
  async loadData() {
    try {
      const res = await fetch("./data/articles.json");
      if (!res.ok) throw new Error("http " + res.status);
      const data = await res.json();
      this.articles = data;
      this.computeTags();
      this._listSig = this.listSig(data);
      await this.loadReviews(); // карта разборов — до первого рендера списка
      const initial = data.find((a) => a.local) || data[0] || null;
      this.setState({ appLoading: false, selectedId: initial ? initial.id : null });
      if (initial) { this.loadArticle(initial); this.loadReview(initial); }
    } catch (e) {
      this.setState({ appLoading: false, loadErr: true });
    }
  }

  async loadArticle(a) {
    if (!a) return;
    if (!a.local) { this.setState({ articleLoading: false, articleErr: false }); return; }
    if (this.htmlCache[a.id]) { this.setState({ articleLoading: false, articleErr: false }); return; }
    this.setState({ articleLoading: true, articleErr: false });
    try {
      const res = await fetch("./data/articles/" + a.folder + "/index.html");
      if (!res.ok) throw new Error("http " + res.status);
      const html = await res.text();
      let meta = null;
      try { const mr = await fetch("./data/articles/" + a.folder + "/meta.json"); if (mr.ok) meta = await mr.json(); } catch (e) {}
      const cleaned = Anno.clean(html, a.folder);
      if (meta) { cleaned.title = meta.title || null; cleaned.date = meta.date || null; }
      this.htmlCache[a.id] = cleaned;
      let fileAnno = [];
      try { const fr = await fetch("./overlay/annotations/" + a.id + ".json"); if (fr.ok) { const j = await fr.json(); if (Array.isArray(j)) fileAnno = j; } } catch (e) {}
      this.fileAnnos[a.id] = fileAnno;
      if (this.loadAnnos(a.id) == null) this.annoStore[a.id] = fileAnno.slice();
      if (this.state.selectedId === a.id) this.setState({ articleLoading: false });
      else this.forceUpdate();
    } catch (e) {
      if (this.state.selectedId === a.id) this.setState({ articleLoading: false, articleErr: true });
    }
  }

  // ---- annotations (state/storage) ----
  loadAnnos(id) {
    try { const raw = localStorage.getItem("chimbal.anno.v1." + id); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  annosFor(id) {
    if (!id) return [];
    if (!this.annoStore[id]) {
      const ls = this.loadAnnos(id);
      this.annoStore[id] = ls != null ? ls : ((this.fileAnnos[id] || []).slice());
    }
    return this.annoStore[id];
  }
  persist(id, arr) {
    this.annoStore[id] = arr;
    try { localStorage.setItem("chimbal.anno.v1." + id, JSON.stringify(arr)); } catch (e) {}
  }

  // ---- разбор: статус + счётчик запросов ----
  // Статус хранится одной картой data/reviews.json { id: {reviewed, requestsAtReview} },
  // загружается разом с индексом → доступен для значков и фильтра в списке.
  // Черновики админа — override'ы в localStorage, считываем один раз при старте.
  REVIEW_LS = "chimbal.review.v1.";
  loadOverrides() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(this.REVIEW_LS) === 0) {
          const id = k.slice(this.REVIEW_LS.length);
          try { const v = JSON.parse(localStorage.getItem(k)); if (v) this.reviewStore[id] = v; } catch (e) {}
        }
      }
    } catch (e) {}
  }
  async loadReviews() {
    try {
      const r = await fetch("./overlay/reviews.json");
      if (r.ok) { const j = await r.json(); if (j && typeof j === "object" && !Array.isArray(j)) this.fileReviews = j; }
    } catch (e) {}
  }
  reviewFor(id) {
    if (!id) return { reviewed: false, requestsAtReview: 0 };
    const o = this.reviewStore[id];                       // локальный override (админ-черновик)
    if (o) return { reviewed: !!o.reviewed, requestsAtReview: Number(o.requestsAtReview) || 0 };
    const f = this.fileReviews[id];                       // закоммиченное значение
    return f ? { reviewed: !!f.reviewed, requestsAtReview: Number(f.requestsAtReview) || 0 } : { reviewed: false, requestsAtReview: 0 };
  }
  persistReview(id, obj) {
    this.reviewStore[id] = obj;
    try { localStorage.setItem(this.REVIEW_LS + id, JSON.stringify(obj)); } catch (e) {}
  }
  isDirtyReview(id) {
    const e = this.reviewFor(id);
    const f = this.fileReviews[id] || { reviewed: false, requestsAtReview: 0 };
    if (e.reviewed !== !!f.reviewed) return true;
    return e.reviewed && (e.requestsAtReview || 0) !== (Number(f.requestsAtReview) || 0);
  }
  reviewsDirty() {
    const ids = new Set([...Object.keys(this.reviewStore), ...Object.keys(this.fileReviews)]);
    for (const id of ids) if (this.isDirtyReview(id)) return true;
    return false;
  }

  // Для открытой статьи считаем число запросов. Разобрана — берём замороженное
  // из карты (без сети); иначе тянем живой счётчик Abacus.
  async loadReview(a) {
    if (!a) return;
    const id = a.id;
    const rev = this.reviewFor(id);
    if (rev.reviewed) { this.setState({ reqLoading: false, reqCount: rev.requestsAtReview || 0, reqDone: ReqCounter.hasRequested(id) }); return; }
    this.setState({ reqLoading: true, reqCount: null, reqDone: ReqCounter.hasRequested(id) });
    let count = 0;
    try { count = await ReqCounter.getCount(id); } catch (e) {}
    if (this.state.selectedId === id) this.setState({ reqLoading: false, reqCount: count, reqDone: ReqCounter.hasRequested(id) });
  }

  requestAnalysis = async () => {
    const id = this.state.selectedId;
    if (!id || this.reviewFor(id).reviewed) return;
    if (ReqCounter.hasRequested(id) || this.state.reqBusy) return;
    this.setState({ reqBusy: true });
    try {
      const n = await ReqCounter.request(id);
      ReqCounter.markRequested(id);
      if (this.state.selectedId === id) this.setState({ reqCount: n, reqDone: true });
    } catch (e) {
      console.warn("requestAnalysis failed", e);
    } finally {
      this.setState({ reqBusy: false });
    }
  };

  toggleReviewed = async () => {
    const id = this.state.selectedId;
    if (!id) return;
    const cur = this.reviewFor(id);
    if (!cur.reviewed) {
      // помечаем разобранным — замораживаем текущее число запросов
      let n = this.state.reqCount;
      if (n == null) { try { n = await ReqCounter.getCount(id); } catch (e) { n = 0; } }
      this.persistReview(id, { reviewed: true, requestsAtReview: Number(n) || 0 });
      this.setState((s) => ({ reviewTick: s.reviewTick + 1, reqCount: Number(n) || 0 }));
    } else {
      // возвращаем кнопку запроса
      this.persistReview(id, { reviewed: false, requestsAtReview: cur.requestsAtReview || 0 });
      this.setState((s) => ({ reviewTick: s.reviewTick + 1 }));
      try { const live = await ReqCounter.getCount(id); if (this.state.selectedId === id) this.setState({ reqCount: live }); } catch (e) {}
    }
  };

  // Собираем всю карту разборов (только reviewed: true — отсутствие = не разобрано)
  // и отдаём как data/reviews.json для коммита.
  collectReviews() {
    const ids = new Set([...Object.keys(this.fileReviews), ...Object.keys(this.reviewStore)]);
    const out = {};
    [...ids].sort().forEach((id) => {
      const e = this.reviewFor(id);
      if (e.reviewed) out[id] = { reviewed: true, requestsAtReview: Number(e.requestsAtReview) || 0 };
    });
    return out;
  }

  // POST в admin-api (overlay). Бросает при недоступности — вызыватель делает фолбэк.
  async postOverlay(path, payload) {
    const res = await fetch(ADMIN_API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("http " + res.status);
  }

  // Сохранить разборы: сначала на сервер, при недоступности — скачать файл.
  saveReview = async () => {
    const out = this.collectReviews();
    try {
      await this.postOverlay("/reviews", out);
      this.fileReviews = out;
      this.setState((s) => ({ reviewTick: s.reviewTick + 1 }));
    } catch (e) { this.exportReview(); }
  };

  exportReview = () => {
    const out = this.collectReviews();
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "reviews.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.fileReviews = out; // новая закоммиченная база → dirty сбрасывается
    this.setState((s) => ({ reviewTick: s.reviewTick + 1 }));
  };

  annotatedHtml(id, cleanHtml) {
    const annos = this.annosFor(id);
    const sig = id + "|" + JSON.stringify(annos);
    if (this._ahSig === sig) return this._ahHtml;
    this._ahHtml = annos.length ? Anno.applyAnnos(cleanHtml, annos) : cleanHtml;
    this._ahSig = sig;
    return this._ahHtml;
  }

  clearBrowserSel() { const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); }

  onBodyMouseUp = () => {
    if (!this.state.adminMode) return;
    const selObj = window.getSelection();
    const root = this.bodyRoot;
    if (!root || !selObj || selObj.rangeCount === 0) return;
    if (selObj.isCollapsed) { if (this.state.toolbar) this.setState({ toolbar: null }); return; }
    const ranges = [];
    let minTop = Infinity, maxBot = -Infinity, sumX = 0, cnt = 0;
    for (let i = 0; i < selObj.rangeCount; i++) {
      const range = selObj.getRangeAt(i);
      if (range.collapsed) continue;
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) continue;
      let start = Anno.offsetIn(root, range.startContainer, range.startOffset);
      let end = Anno.offsetIn(root, range.endContainer, range.endOffset);
      if (start === end) continue;
      if (start > end) { const t = start; start = end; end = t; }
      ranges.push({ start, end });
      const rect = range.getBoundingClientRect();
      minTop = Math.min(minTop, rect.top); maxBot = Math.max(maxBot, rect.bottom);
      sumX += rect.left + rect.width / 2; cnt++;
    }
    if (!ranges.length) { if (this.state.toolbar) this.setState({ toolbar: null }); return; }
    const x = sumX / cnt;
    this.currentSel = { ranges, x, yTop: minTop, yBot: maxBot };
    this.setState({ toolbar: { x, yTop: minTop, yBot: maxBot }, note: null });
  };

  onBodyClick = (e) => {
    const badge = e.target.closest && e.target.closest("[data-anno-note]");
    const mark = e.target.closest && e.target.closest("[data-anno]");
    const id = badge ? badge.getAttribute("data-anno-note") : (mark ? mark.getAttribute("data-anno") : null);
    if (!id) return;
    const a = this.annosFor(this.state.selectedId).find((x) => x.id === id);
    if (!a) return;
    if (a.note == null && !this.state.adminMode) return;
    const el = badge || mark;
    const rect = el.getBoundingClientRect();
    this.setState({ note: { id, x: rect.left + rect.width / 2, y: rect.bottom, draft: a.note || "" }, toolbar: null });
  };

  addAnno(color, withNote) {
    const sel = this.currentSel;
    if (!sel || !sel.ranges || !sel.ranges.length) return;
    const arr = this.annosFor(this.state.selectedId).slice();
    let lastId = null;
    if (withNote) {
      // один комментарий может указывать на несколько мест — группируем под одной пометкой
      const id = Anno.uid();
      arr.push({ id, ranges: sel.ranges.slice(), color, note: "", ts: Date.now() });
      lastId = id;
    } else {
      // отдельная подсветка на каждое выделенное место
      for (const r of sel.ranges) { const id = Anno.uid(); arr.push({ id, ranges: [r], color, note: null, ts: Date.now() }); lastId = id; }
    }
    this.persist(this.state.selectedId, arr);
    this.clearBrowserSel();
    if (withNote) this.setState((s) => ({ toolbar: null, annoTick: s.annoTick + 1, note: { id: lastId, x: sel.x, y: sel.yBot, draft: "" } }));
    else this.setState((s) => ({ toolbar: null, annoTick: s.annoTick + 1 }));
  }

  startComment = () => this.addAnno("yellow", true);

  recolor(id, color) {
    const arr = this.annosFor(this.state.selectedId).map((a) => a.id === id ? Object.assign({}, a, { color }) : a);
    this.persist(this.state.selectedId, arr);
    this.setState((s) => ({ annoTick: s.annoTick + 1 }));
  }

  setNoteDraft = (e) => { const v = e.target.value; this.setState((s) => ({ note: Object.assign({}, s.note, { draft: v }) })); };

  saveNote = () => {
    const n = this.state.note; if (!n) return;
    const draft = (n.draft || "").trim();
    const arr = this.annosFor(this.state.selectedId).map((a) => a.id === n.id ? Object.assign({}, a, { note: draft === "" ? null : draft }) : a);
    this.persist(this.state.selectedId, arr);
    this.setState((s) => ({ note: null, annoTick: s.annoTick + 1 }));
  };

  deleteCurrentAnno = () => {
    const n = this.state.note; if (!n) return;
    const arr = this.annosFor(this.state.selectedId).filter((a) => a.id !== n.id);
    this.persist(this.state.selectedId, arr);
    this.setState((s) => ({ note: null, annoTick: s.annoTick + 1 }));
  };

  closeNote = () => this.setState({ note: null });

  togglePanel = () => this.setState((s) => ({ panelOpen: !s.panelOpen }));

  exportAnnos = () => {
    const id = this.state.selectedId;
    const arr = this.annosFor(id);
    const blob = new Blob([JSON.stringify(arr, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "annotations.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.fileAnnos[id] = arr.slice();
    this.setState((s) => ({ annoTick: s.annoTick + 1 }));
  };

  // Сохранить пометки статьи: сначала на сервер (overlay), иначе скачать файл.
  saveAnnos = async () => {
    const id = this.state.selectedId;
    const arr = this.annosFor(id);
    try {
      await this.postOverlay("/annotations/" + id, arr);
      this.fileAnnos[id] = arr.slice();
      this.setState((s) => ({ annoTick: s.annoTick + 1 }));
    } catch (e) { this.exportAnnos(); }
  };

  // Импорт ранее выгруженного annotations.json обратно в сессию (перенос между браузерами).
  importAnnos = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(reader.result);
        if (Array.isArray(j)) {
          this.persist(this.state.selectedId, j);
          this.setState((s) => ({ annoTick: s.annoTick + 1 }));
        }
      } catch (err) { /* битый файл — игнор */ }
    };
    reader.readAsText(file);
  };

  resetAnnos = () => {
    const id = this.state.selectedId;
    const base = (this.fileAnnos[id] || []).slice();
    this.persist(id, base);
    this.setState((s) => ({ annoTick: s.annoTick + 1, note: null }));
  };

  jumpTo = (id) => {
    const root = this.bodyRoot; if (!root) return;
    const el = root.querySelector('[data-anno="' + id + '"]');
    const main = this.mainEl;
    if (el && main) { const r = el.getBoundingClientRect(); main.scrollTop += r.top - 170; }
    const a = this.annosFor(this.state.selectedId).find((x) => x.id === id);
    if (el && a && a.note != null) { const r = el.getBoundingClientRect(); this.setState({ note: { id, x: r.left + r.width / 2, y: r.bottom, draft: a.note || "" } }); }
  };

  openEditor = (id, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const a = this.annosFor(this.state.selectedId).find((x) => x.id === id);
    if (!a) return;
    const root = this.bodyRoot;
    const el = root && root.querySelector('[data-anno="' + id + '"]');
    let x = window.innerWidth / 2, y = 180;
    if (el) {
      const main = this.mainEl;
      const r0 = el.getBoundingClientRect();
      if (main) main.scrollTop += r0.top - 220;
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.bottom;
    }
    this.setState({ note: { id, x, y, draft: a.note || "" }, toolbar: null });
  };

  deleteAnno = (id, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const arr = this.annosFor(this.state.selectedId).filter((a) => a.id !== id);
    this.persist(this.state.selectedId, arr);
    this.setState((s) => ({ annoTick: s.annoTick + 1, note: null }));
  };

  acceptGate = () => { try { localStorage.setItem("chimbal.gate.v1", "1"); } catch (e) {} this.setState({ gateOpen: false }); };
  declineGate = () => { window.location.href = LANDING_URL; };

  toggleAdmin = () => this.setState((s) => {
    const v = !s.adminMode;
    try { localStorage.setItem("chimbal.admin.v1", v ? "1" : "0"); } catch (e) {}
    return { adminMode: v, toolbar: null, note: null };
  });

  // ---- lifecycle ----
  componentDidMount() { this.loadOverrides(); this.loadData(); this.startAutoRefresh(); }
  componentWillUnmount() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    if (this._onVisible) document.removeEventListener("visibilitychange", this._onVisible);
  }

  // Список статей пополняет апдейтер на сервере. Периодически перечитываем
  // articles.json (no-cache → 304, когда без изменений) + при возврате фокуса,
  // чтобы новые статьи появлялись без перезагрузки страницы.
  REFRESH_MS = 60000;
  listSig(arr) { return arr.length + "|" + arr.map((a) => a.id + (a.local ? "1" : "0")).join(","); }
  startAutoRefresh() {
    this._refreshTimer = setInterval(() => this.refreshList(), this.REFRESH_MS);
    this._onVisible = () => { if (!document.hidden) this.refreshList(); };
    document.addEventListener("visibilitychange", this._onVisible);
  }
  async refreshList() {
    if (this.state.appLoading || this._refreshing) return;
    this._refreshing = true;
    try {
      const res = await fetch("./data/articles.json");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && this.listSig(data) !== this._listSig) {
          this._listSig = this.listSig(data);
          this.articles = data;
          this.computeTags();
          await this.loadReviews();
          // открытую статью только что импортировал апдейтер — подгрузим контент
          const sel = this.articles.find((a) => a.id === this.state.selectedId);
          if (sel && sel.local && !this.htmlCache[sel.id]) this.loadArticle(sel);
          this.forceUpdate();
        }
      }
    } catch (e) { /* offline/transient — игнор */ }
    this._refreshing = false;
  }

  // ---- view helpers ----
  chipBase() {
    return { display: "inline-flex", alignItems: "baseline", gap: "5px", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px", letterSpacing: "0.01em", padding: "5px 11px", borderRadius: "20px" };
  }
  fmtDate(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
  }
  fmtNum(n) { return (n || 0).toLocaleString("ru-RU"); }
  pluralReq(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return "запросов";
    if (b > 1 && b < 5) return "запроса";
    if (b === 1) return "запрос";
    return "запросов";
  }

  render() {
    const { query, activeTags, selectedId, tagMenuOpen, appLoading, articleLoading, articleErr, adminMode, toolbar, note, reqLoading, reqCount, reqDone, reqBusy, reviewFilter } = this.state;
    const q = query.trim().toLowerCase();

    const matches = (a) => {
      const textOk = !q || (a.title + " " + a.tags.join(" ") + " " + a.slug).toLowerCase().includes(q);
      const tagOk = activeTags.length === 0 || a.tags.some((t) => activeTags.includes(t));
      const reviewOk = !reviewFilter || (this.reviewFor(a.id).reviewed ? reviewFilter === "reviewed" : reviewFilter === "pending");
      return textOk && tagOk && reviewOk;
    };
    const filtered = this.articles.filter(matches);

    const counts = this.tagCounts || {};
    const allTags = this.allTags || [];

    const topTags = allTags.slice(0, 4);
    const visible = [...topTags];
    activeTags.forEach((t) => { if (!visible.includes(t)) visible.push(t); });

    const mkChipStyle = (active) => Object.assign(this.chipBase(), active
      ? { border: "1px solid transparent", background: "linear-gradient(135deg, #39ff8b, #1fd97a)", color: "#06140c", fontWeight: 600, boxShadow: "0 0 16px -6px #39ff8b" }
      : { border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "rgba(214,210,235,0.78)" });

    const chips = visible.map((name) => ({
      name, count: counts[name] || 0, toggle: () => this.toggleTag(name), style: mkChipStyle(activeTags.includes(name))
    }));

    const moreStyle = Object.assign(this.chipBase(), { border: "1px dashed rgba(255,255,255,0.22)", background: "transparent", color: "rgba(214,210,235,0.7)" });
    const hiddenCount = allTags.filter((t) => !visible.includes(t)).length;

    const menuTags = allTags.map((name) => {
      const active = activeTags.includes(name);
      return {
        name, count: counts[name], toggle: () => this.toggleTag(name),
        style: {
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "8px 9px", borderRadius: "8px", cursor: "pointer", border: "none",
          background: active ? "rgba(57,255,139,0.12)" : "transparent",
          fontFamily: "'Onest', sans-serif", fontSize: "13px",
          color: active ? "#9bffc4" : "rgba(243,241,251,0.85)"
        },
        dotStyle: {
          display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", flex: "0 0 auto",
          background: active ? "linear-gradient(135deg, #39ff8b, #1fd97a)" : "transparent",
          boxShadow: active ? "0 0 8px -1px #39ff8b" : "none",
          border: active ? "none" : "1px solid rgba(255,255,255,0.25)"
        }
      };
    });

    const shown = filtered.slice(0, this.LIST_CAP);
    const list = shown.map((a) => {
      const selected = a.id === selectedId;
      return {
        id: a.id, title: a.title, date: this.fmtDate(a.date) || "—", tagsLabel: a.tags.join(" · "),
        reviewed: this.reviewFor(a.id).reviewed,
        select: () => this.select(a.id),
        style: {
          display: "block", width: "100%", textAlign: "left", cursor: "pointer",
          padding: selected ? "15px 20px 15px 17px" : "15px 20px",
          background: selected ? "rgba(255,255,255,0.055)" : "transparent",
          borderLeft: selected ? "3px solid #39ff8b" : "3px solid transparent",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          fontFamily: "'Golos Text', sans-serif"
        },
        titleStyle: {
          fontFamily: "'Golos Text', sans-serif",
          fontSize: "16px", fontWeight: 500, lineHeight: "1.3", marginBottom: "6px",
          color: selected ? "#ffffff" : "#e9e6f5"
        }
      };
    });

    const sel = this.articles.find((a) => a.id === selectedId) || null;
    const hasSelection = !appLoading && !!sel;
    const cached = sel ? this.htmlCache[sel.id] : null;
    const isLocal = sel ? !!sel.local : false;
    const bodyReady = hasSelection && isLocal && !!cached && !articleLoading;
    const notImported = hasSelection && !isLocal && !articleLoading;

    let bodyEl = null, words = 0;
    if (cached) {
      words = cached.words;
      const annotated = this.annotatedHtml(sel.id, cached.html);
      bodyEl = React.createElement("div", {
        ref: (el) => { this.bodyRoot = el; },
        onMouseUp: this.onBodyMouseUp,
        onClick: this.onBodyClick,
        style: { fontSize: "18px", lineHeight: "1.78", color: "#2f2a25" },
        dangerouslySetInnerHTML: { __html: annotated }
      });
    }

    const realTitle = (cached && cached.title) || (sel ? sel.title : "");
    const dateStr = sel ? this.fmtDate((cached && cached.date) || sel.date) : "";
    const metaLabel = [dateStr, bodyReady ? words + " слов" : ""].filter(Boolean).join(" · ") || "overclockers.ru";

    // сводка по пометкам
    const annos = sel ? this.annosFor(sel.id) : [];
    const noteCount = annos.filter((a) => a.note != null).length;
    let annoSummary = "Без пометок";
    if (annos.length) annoSummary = annos.length + " подсвет." + (noteCount ? " · " + noteCount + " коммент." : "");

    // список пометок
    const aText = (cached && cached.text) || "";
    const annoList = annos.slice().sort((a, b) => Anno.firstStart(a) - Anno.firstStart(b)).map((a) => {
      const p = Anno.pal(a.color);
      const rgs = Anno.rangesOf(a).slice().sort((x, y) => x.start - y.start);
      let snip = rgs.map((rg) => aText.slice(rg.start, rg.end).replace(/\s+/g, " ").trim()).filter(Boolean).join(" … ");
      if (snip.length > 64) snip = snip.slice(0, 64) + "…";
      return {
        id: a.id, snippet: snip || "(фрагмент)", note: a.note || "", hasNote: a.note != null,
        multi: rgs.length > 1 ? rgs.length + " мест" : "",
        jump: () => this.jumpTo(a.id),
        edit: (e) => this.openEditor(a.id, e),
        remove: (e) => this.deleteAnno(a.id, e),
        dot: { display: "block", flex: "0 0 auto", width: "12px", height: "12px", marginTop: "4px", borderRadius: "4px", background: p.solid, boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }
      };
    });
    const fileArr = sel ? (this.fileAnnos[sel.id] || []) : [];
    const dirty = JSON.stringify(annos) !== JSON.stringify(fileArr);

    // тулбар выделения
    const swatches = Anno.PALETTE.map((p) => ({
      title: p.title, pick: () => this.addAnno(p.key, false),
      style: { width: "20px", height: "20px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.35)", background: p.solid, cursor: "pointer", padding: 0, transition: "transform .1s" }
    }));
    let toolbarStyle = null, toolbarOpen = false;
    if (toolbar && adminMode) {
      toolbarOpen = true;
      const above = toolbar.yTop > 84;
      toolbarStyle = {
        position: "fixed", left: Math.max(120, Math.min(window.innerWidth - 120, toolbar.x)) + "px",
        top: (above ? toolbar.yTop - 10 : toolbar.yBot + 10) + "px",
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        zIndex: 70, display: "flex", alignItems: "center", gap: "7px",
        padding: "7px 9px", borderRadius: "11px",
        background: "rgba(16,13,28,0.97)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 16px 40px -12px rgba(0,0,0,0.7)"
      };
    }

    // попап комментария
    let notePopoverOpen = false, notePopoverStyle = null, noteDraft = "", noteText = "", noteReadOnly = false, noteHeader = "Комментарий", noteSwatches = [];
    if (note) {
      const a = annos.find((x) => x.id === note.id);
      if (a) {
        notePopoverOpen = true;
        noteDraft = note.draft != null ? note.draft : (a.note || "");
        noteText = a.note || "";
        noteReadOnly = !adminMode && a.note != null;
        noteHeader = adminMode ? "Пометка администратора" : "Комментарий";
        noteSwatches = Anno.PALETTE.map((p) => ({
          title: p.title, pick: () => this.recolor(note.id, p.key),
          style: { width: "22px", height: "22px", borderRadius: "50%", cursor: "pointer", padding: 0, background: p.solid, border: a.color === p.key ? "2px solid #2a2622" : "1px solid rgba(0,0,0,0.15)" }
        }));
        notePopoverStyle = {
          position: "fixed", left: Math.max(160, Math.min(window.innerWidth - 160, note.x)) + "px",
          top: Math.min(window.innerHeight - 40, note.y + 10) + "px",
          transform: "translateX(-50%)", zIndex: 70, width: "300px",
          padding: "15px 16px 16px", borderRadius: "13px",
          background: "#fbf9f3", border: "1px solid #e3dbcb",
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.55)"
        };
      }
    }

    const countLabel = this.state.loadErr ? "ошибка загрузки" : (filtered.length + " / " + this.articles.length + " текстов");
    const hasFilters = activeTags.length > 0 || q.length > 0 || !!reviewFilter;
    const moreInList = filtered.length > this.LIST_CAP;
    const moreCount = filtered.length - this.LIST_CAP;
    const isEmpty = !appLoading && filtered.length === 0;
    const emptyText = this.state.loadErr ? "Не удалось загрузить архив." : "Ничего не найдено. Измените запрос или сбросьте фильтры.";
    const loadingLabel = this.state.loadErr ? "Ошибка" : "Загрузка архива…";
    const adminBtnLabel = adminMode ? "✓ Режим редактора" : "✎ Режим редактора";
    const adminBtnStyle = {
      fontFamily: "'Onest', sans-serif", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
      padding: "8px 14px", borderRadius: "9px", whiteSpace: "nowrap",
      border: adminMode ? "1px solid #2f9e57" : "1px solid #ddd2bf",
      background: adminMode ? "linear-gradient(135deg, #eafaef, #d7f0dd)" : "#fbf9f3",
      color: adminMode ? "#1f7a42" : "#6b6253"
    };
    const panelChevron = this.state.panelOpen ? "▾" : "▸";

    // разбор: статус + запросы
    const rev = sel ? this.reviewFor(sel.id) : { reviewed: false, requestsAtReview: 0 };
    const reviewed = !!rev.reviewed;
    const reviewedCount = rev.requestsAtReview || 0;
    const dirtyReview = this.reviewsDirty();
    const reqBtnLabel = reqDone ? "Запрошено ✦" : "Хочу разбор ✦";
    const reqCountLabel = reqCount == null ? "…" : (this.fmtNum(reqCount) + " " + this.pluralReq(reqCount));

    return (
      <div className="arc-stage">
        <Starfield />
        <div className="arc-vignette" />

        <header className="arc-header">
          <div className="arc-brand">
            <div className="arc-logo"><div className="arc-logo-inner"><img src="assets/ava.webp" alt="" /></div></div>
            <div className="arc-brand-text">
              <span className="arc-brand-sub">ncrc-x-chimbal</span>
              <span className="arc-brand-title">Архив</span>
            </div>
          </div>
          <a href={LANDING_URL} className="arc-back"><span className="arc-back-ic">↩</span> На лендинг</a>
        </header>

        <div className="arc-body">

          <aside className="arc-side">
            <div className="arc-side-top">
              <div className="arc-search">
                <span className="arc-search-ic">⌕</span>
                <input className="arc-search-input" value={query} onChange={this.setQuery} placeholder="Поиск по архиву…" />
              </div>

              <div className="arc-flabel">Фильтр по тегам</div>
              <div style={{ position: "relative" }}>
                <div className="arc-chips">
                  {chips.map((chip) => (
                    <button key={chip.name} className="arc-chip" onClick={chip.toggle} style={chip.style}>
                      <span>{chip.name}</span>
                      <span style={{ opacity: 0.6, fontSize: "10px" }}>{chip.count}</span>
                    </button>
                  ))}
                  {hiddenCount > 0 && (
                    <button className="arc-chip" onClick={this.toggleTagMenu} style={moreStyle}>
                      <span>ещё</span>
                      <span style={{ opacity: 0.6, fontSize: "10px" }}>{hiddenCount}</span>
                      <span style={{ fontSize: "9px", opacity: 0.7 }}>▾</span>
                    </button>
                  )}
                </div>

                {tagMenuOpen && (
                  <React.Fragment>
                    <div className="arc-menu-veil" onClick={this.closeMenu} />
                    <div className="arc-menu">
                      <div className="arc-menu-title">Все теги</div>
                      {menuTags.map((row) => (
                        <button key={row.name} className="arc-menu-row" onClick={row.toggle} style={row.style}>
                          <span style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                            <span style={row.dotStyle}></span>
                            <span>{row.name}</span>
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", opacity: 0.5 }}>{row.count}</span>
                        </button>
                      ))}
                    </div>
                  </React.Fragment>
                )}
              </div>

              <div className="arc-rfilter">
                <span className="arc-rfilter-label">Разбор</span>
                <button
                  className={"arc-rfilter-btn is-done" + (reviewFilter === "reviewed" ? " active" : "")}
                  onClick={() => this.setReviewFilter("reviewed")}
                  title="Только разобранные">✓</button>
                <button
                  className={"arc-rfilter-btn is-pending" + (reviewFilter === "pending" ? " active" : "")}
                  onClick={() => this.setReviewFilter("pending")}
                  title="Только без разбора">?</button>
              </div>

              <div className="arc-count">
                <span>{countLabel}</span>
                {hasFilters && <button className="arc-reset" onClick={this.clearFilters}>сбросить</button>}
              </div>
            </div>

            <div className="arc-list">
              {list.map((item) => (
                <button key={item.id} className="arc-item" onClick={item.select} style={item.style}>
                  <div className="arc-item-top">
                    <div style={item.titleStyle}>{item.title}</div>
                    <span
                      className={"arc-item-ic " + (item.reviewed ? "is-done" : "is-pending")}
                      title={item.reviewed ? "Разобрано" : "Разбора пока нет"}>{item.reviewed ? "✓" : "?"}</span>
                  </div>
                  <div className="arc-item-meta">
                    <span>{item.date}</span>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span className="arc-item-tags">{item.tagsLabel}</span>
                  </div>
                </button>
              ))}
              {moreInList && (
                <div className="arc-more">… ещё {moreCount}. Уточните поиск или выберите тег.</div>
              )}
              {isEmpty && <div className="arc-empty">{emptyText}</div>}
            </div>
          </aside>

          <main className="arc-main" ref={(el) => { this.mainEl = el; }}>
            {appLoading && (
              <div className="arc-loading">
                <div className="arc-spin"></div>
                <span className="arc-loading-label">{loadingLabel}</span>
              </div>
            )}

            {hasSelection && (
              <div className="arc-paper">
                <article className="arc-article">

                  <div className="arc-art-top">
                    <span className="arc-anno-sum">{annoSummary}</span>
                    <button onClick={this.toggleAdmin} style={adminBtnStyle}>{adminBtnLabel}</button>
                  </div>
                  {adminMode && (
                    <div className="arc-admin-hint">
                      <span style={{ fontSize: "14px" }}>✎</span> Выделите текст мышью — появится палитра подсветки и кнопка комментария. Можно выделить несколько мест сразу, удерживая Ctrl. Клик по пометке открывает её.
                    </div>
                  )}

                  <div className="arc-tags">
                    {(sel ? sel.tags : []).map((t, i) => (
                      <span key={i} className="arc-tag">{t}</span>
                    ))}
                  </div>
                  <h1 lang="ru" className="arc-h1">{realTitle}</h1>
                  <div className="arc-meta">
                    <span>{metaLabel}</span>
                    <a href={sel ? sel.url : "#"} target="_blank" rel="noopener" className="arc-orig">оригинал ↗</a>
                  </div>

                  <div className="arc-cta">
                    {reviewed ? (
                      <div className="arc-cta-done">
                        <span className="arc-cta-check">✓</span>
                        <span>Разобрано{reviewedCount > 0 ? " · по запросу " + this.fmtNum(reviewedCount) : ""}</span>
                      </div>
                    ) : (
                      <div className="arc-cta-ask">
                        <span className="arc-cta-head">
                          <span className="arc-cta-q">?</span>
                          <span className="arc-cta-text">Разбора пока нет</span>
                        </span>
                        <button
                          className={"arc-cta-btn" + (reqDone ? " is-done" : "")}
                          onClick={this.requestAnalysis}
                          disabled={reqDone || reqBusy || reqLoading}>
                          {reqBtnLabel}
                        </button>
                        <span className="arc-cta-count">{reqCountLabel}</span>
                      </div>
                    )}
                    {adminMode && (
                      <div className="arc-cta-admin">
                        <button className="arc-btn-tan" onClick={this.toggleReviewed}>{reviewed ? "↩ Вернуть кнопку" : "✓ Отметить разобранным"}</button>
                        {dirtyReview && <button className="arc-btn-green" onClick={this.saveReview}>💾 Сохранить разборы</button>}
                      </div>
                    )}
                  </div>

                  {annos.length > 0 && (
                    <div className="arc-panel">
                      <button onClick={this.togglePanel} className="arc-panel-head">
                        <span>Пометки · {annos.length}</span>
                        <span className="arc-panel-head-right">
                          {dirty && <span className="arc-dirty">● не сохранено в файл</span>}
                          <span style={{ fontSize: "13px" }}>{panelChevron}</span>
                        </span>
                      </button>
                      {this.state.panelOpen && (
                        <div className="arc-panel-body">
                          {annoList.map((an) => (
                            <div key={an.id} onClick={an.jump} className="arc-panel-row">
                              <span style={an.dot}></span>
                              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                                <div className="arc-snip">«{an.snippet}»</div>
                                {an.hasNote && <div className="arc-snip-note">{an.note}</div>}
                                {an.multi && <div className="arc-multi">⛓ {an.multi}</div>}
                              </div>
                              {adminMode && (
                                <div className="arc-row-acts">
                                  <button onClick={an.edit} title="Редактировать" className="arc-mini arc-mini-edit">✎</button>
                                  <button onClick={an.remove} title="Удалить" className="arc-mini arc-mini-del">🗑</button>
                                </div>
                              )}
                            </div>
                          ))}
                          {adminMode && (
                            <div className="arc-export-bar">
                              <button onClick={this.saveAnnos} className="arc-btn-green">💾 Сохранить</button>
                              <label className="arc-btn-tan" style={{ cursor: "pointer" }}>↑ Импорт
                                <input type="file" accept="application/json,.json" onChange={this.importAnnos} style={{ display: "none" }} />
                              </label>
                              <button onClick={this.exportAnnos} className="arc-btn-tan">↓ Экспорт</button>
                              {dirty && <button onClick={this.resetAnnos} className="arc-btn-tan">Сбросить</button>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {articleLoading && (
                    <div className="arc-art-loading">
                      <div className="arc-spin-sm"></div>
                      Загрузка статьи…
                    </div>
                  )}
                  {bodyReady && <ErrorBoundary key={sel.id} url={sel.url}><div>{bodyEl}</div></ErrorBoundary>}
                  {notImported && (
                    <div className="arc-box-tan">
                      Эта статья ещё не импортирована в архив. После выгрузки её папки <code className="arc-code">{sel ? sel.folder : ""}</code> текст и изображения появятся здесь.
                      <div style={{ marginTop: "16px" }}><a href={sel ? sel.url : "#"} target="_blank" rel="noopener" style={{ color: "#9d4b35", fontWeight: 500 }}>Открыть оригинал на overclockers.ru ↗</a></div>
                    </div>
                  )}
                  {articleErr && (
                    <div className="arc-box-red">
                      Не удалось загрузить текст статьи. <a href={sel ? sel.url : "#"} target="_blank" rel="noopener" style={{ color: "#9d4b35", fontWeight: 500 }}>Открыть оригинал ↗</a>
                    </div>
                  )}
                </article>
              </div>
            )}
          </main>

        </div>

        {toolbarOpen && (
          <div style={toolbarStyle}>
            {swatches.map((sw, i) => (
              <button key={i} onClick={sw.pick} title={sw.title} className="arc-sw" style={sw.style}></button>
            ))}
            <span className="arc-tb-div"></span>
            <button onClick={this.startComment} title="Добавить комментарий" className="arc-tb-comment">
              <span style={{ fontSize: "12px" }}>💬</span> коммент
            </button>
          </div>
        )}

        {notePopoverOpen && (
          <React.Fragment>
            <div className="arc-note-veil" onClick={this.closeNote} />
            <div style={notePopoverStyle}>
              <div className="arc-note-head">
                <span className="arc-note-label">{noteHeader}</span>
                <button onClick={this.closeNote} className="arc-note-x">×</button>
              </div>
              {adminMode && (
                <React.Fragment>
                  <div className="arc-note-sw-row">
                    {noteSwatches.map((sw, i) => (
                      <button key={i} onClick={sw.pick} title={sw.title} style={sw.style}></button>
                    ))}
                  </div>
                  <textarea value={noteDraft} onChange={this.setNoteDraft} className="anno-tarea" placeholder="Комментарий администратора…"></textarea>
                  <div className="arc-note-btns">
                    <button onClick={this.deleteCurrentAnno} className="arc-note-del">Удалить</button>
                    <button onClick={this.saveNote} className="arc-note-save">Сохранить</button>
                  </div>
                </React.Fragment>
              )}
              {noteReadOnly && <div className="arc-note-ro">{noteText}</div>}
            </div>
          </React.Fragment>
        )}

        {this.state.gateOpen && (
          <div className="arc-gate">
            <div className="arc-gate-card">
              <div className="arc-gate-icon">⚠</div>
              <div className="arc-gate-eyebrow">Предупреждение · 18+</div>
              <h2 className="arc-gate-title">Дальше — не для слабонервных</h2>
              <p className="arc-gate-text">Вы входите в архив с резкими суждениями и провокационными материалами. Продолжая, вы подтверждаете, что вам есть 18 лет и вы осознаёте характер контента.</p>
              <div className="arc-gate-btns">
                <button onClick={this.acceptGate} className="arc-gate-accept">Мне есть 18 — войти</button>
                <button onClick={this.declineGate} className="arc-gate-decline">Увести меня отсюда</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<Archive />);
