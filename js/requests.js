/* requests.js — window.ReqCounter
 *
 * Счётчик «запросов на разбор» по каждой статье. Бэкенда нет — как и на
 * лендинге, считаем публичным API Abacus (https://abacus.jasoncameron.dev):
 * без регистрации, бесплатно, CORS.
 *   GET /get/<ns>/req-<id>  -> { "value": N }   прочитать (без +1)
 *   GET /hit/<ns>/req-<id>  -> { "value": N }   +1 и вернуть новое
 *
 * namespace виден в исходнике — для статики это ок. Сменить провайдера/ns =
 * править только этот файл. Дедуп «один человек = один запрос» — клиентский,
 * флаг в localStorage (серверного дедупа публичный API не даёт).
 */
window.ReqCounter = (function () {
  const API = "https://abacus.jasoncameron.dev";
  const NS = "ncrc-x-chimbal";

  // ключ Abacus: только [A-Za-z0-9_-]. id статей — числовые строки, но
  // подстрахуемся и вычистим всё лишнее.
  const keyFor = (id) => "req-" + String(id).replace(/[^A-Za-z0-9_-]/g, "");
  const flagFor = (id) => "ncrc.req." + id;

  async function getCount(id) {
    try {
      const r = await fetch(`${API}/get/${NS}/${keyFor(id)}`);
      const j = await r.json();
      return Number(j.value) || 0; // {"error":"Key not found"} до первого запроса -> 0
    } catch (e) {
      console.warn("ReqCounter.getCount failed", e);
      return 0;
    }
  }

  async function request(id) {
    const r = await fetch(`${API}/hit/${NS}/${keyFor(id)}`);
    const j = await r.json();
    return Number(j.value) || 0;
  }

  function hasRequested(id) {
    try { return localStorage.getItem(flagFor(id)) === "1"; } catch (e) { return false; }
  }
  function markRequested(id) {
    try { localStorage.setItem(flagFor(id), "1"); } catch (e) {}
  }
  // утилита для тестов — сбросить «уже запрашивал» (вызвать из консоли)
  function _reset(id) {
    try { localStorage.removeItem(flagFor(id)); } catch (e) {}
  }

  return { getCount, request, hasRequested, markRequested, _reset };
})();
