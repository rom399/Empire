/**
 * First half of the dashboard's client script: shared state, the event
 * stream, and the plain-DOM overlay (counters, logs, and the drill-down
 * panel). It has no dependency on three.js - if the 3D half cannot load,
 * everything here still works on its own.
 *
 * Authoring rules for this file: it is embedded via String.raw, so it must
 * contain no backticks and no "${" sequences (string concatenation only),
 * and no closing script tag. __BASE_PATH__ / __THREE_BASE__ are replaced
 * with JSON string literals when the page is rendered. All server-supplied
 * text (ids, urls, paths, routes) reaches the DOM through textContent only.
 */
export const DASHBOARD_OVERLAY_SCRIPT = String.raw`
const BASE = __BASE_PATH__;
const THREE_BASE = __THREE_BASE__;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ANIMATE_WINDOW_MS = 2000;
const LOG_LIMIT = 50;
const TAIL_DATA_LIMIT = 300;
const TAIL_DOM_LIMIT = 100;
const PAUSED_BUFFER_LIMIT = 500;
const RATE_WINDOW_MS = 10000;
const DETAIL_REFRESH_MS = 3000;
const REMOVED_KEEP_MS = 30000;
const DEFAULT_LEASE_TTL_MS = 15000;
const OVERLAY_INTERVAL_MS = 250;
const STAMP_LIMIT = 4000;

const $ = function (id) { return document.getElementById(id); };

function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
        for (const key in props) {
            const value = props[key];
            if (value === undefined || value === null) { continue; }
            if (key === "class") { el.className = value; }
            else if (key === "text") { el.textContent = value; }
            else if (key.indexOf("on") === 0) { el.addEventListener(key.slice(2), value); }
            else { el.setAttribute(key, value); }
        }
    }
    for (let i = 2; i < arguments.length; i++) {
        const child = arguments[i];
        if (child === undefined || child === null) { continue; }
        el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
}

function setText(el, text) {
    if (el.textContent !== text) { el.textContent = text; }
}

function fmtMs(ms) {
    if (ms === null || ms === undefined) { return "-"; }
    if (ms >= 1000) { return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + " s"; }
    if (ms >= 100) { return Math.round(ms) + " ms"; }
    return ms.toFixed(1) + " ms";
}

function fmtTime(ts) {
    const d = new Date(ts);
    const two = function (n) { return (n < 10 ? "0" : "") + n; };
    return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
}

function statusClassOf(status) { return Math.floor(status / 100) + "xx"; }
function statusCss(status, failed) {
    if (failed || status === null || status === undefined) { return "cf"; }
    return "c" + Math.floor(status / 100);
}

/* The same id-guessing the server falls back to - used to key a call under a route when the backend reported none. */
const ID_NUMERIC = /^\d+$/;
const ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_HEX = /^[0-9a-f]{16,}$/i;
const ID_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
function normalizePath(path) {
    const q = path.indexOf("?");
    const only = q === -1 ? path : path.slice(0, q);
    return only.split("/").map(function (seg) {
        return (ID_NUMERIC.test(seg) || ID_UUID.test(seg) || ID_HEX.test(seg) || ID_ULID.test(seg)) ? ":id" : seg;
    }).join("/");
}

/* ---------------------------------------------------------------- state */

const S = {
    strategy: "-",
    unroutable: 0,
    clockOffset: 0,
    connected: false,
    backends: new Map(),
    pending: new Map(),
    dispatchStamps: [],
    requestRows: new Map(),
    focusId: null,
    detail: null,
    hoverRoute: null,
    routeFilter: null,
    sortKey: "count",
    sortDir: -1
};

let scene3d = null;

function serverNow() { return Date.now() + S.clockOffset; }

function newBackend(info) {
    return {
        id: info.id, url: info.url, source: info.source,
        addedAt: info.addedAt || serverNow(),
        expiresAt: info.expiresAt || null,
        leaseTtl: DEFAULT_LEASE_TTL_MS,
        total: 0, inFlight: 0, completed: 0, failed: 0, aborted: 0,
        sc: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
        latSum: 0, lastMs: null, removed: null, errEwma: 0, view: null
    };
}

function copyCounters(b, sb, snapAt) {
    b.total = sb.total; b.inFlight = sb.inFlight; b.completed = sb.completed;
    b.failed = sb.failed; b.aborted = sb.aborted;
    b.sc = Object.assign({ "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }, sb.statusClasses);
    b.latSum = sb.avgLatencyMs * sb.completed;
    b.lastMs = sb.lastLatencyMs === undefined ? null : sb.lastLatencyMs;
    b.expiresAt = sb.expiresAt || null;
    b.addedAt = sb.addedAt;
    if (b.expiresAt) { b.leaseTtl = Math.max(b.leaseTtl, b.expiresAt - snapAt); }
}

/* ---------------------------------------------------------- event stream */

let queue = [];

function connect() {
    const source = new EventSource(BASE + "/events");
    source.addEventListener("snapshot", function (e) { queue.push({ snap: JSON.parse(e.data), t: performance.now() }); });
    source.onmessage = function (e) { queue.push({ ev: JSON.parse(e.data), t: performance.now() }); };
    source.onopen = function () { S.connected = true; };
    source.onerror = function () { S.connected = false; };
}

function drainQueue() {
    if (queue.length === 0) { return; }
    const items = queue;
    queue = [];
    const now = performance.now();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.snap) { applySnapshot(item.snap); continue; }
        /* Events that piled up while the tab was hidden update the numbers but are not replayed as animation. */
        applyEvent(item.ev, now - item.t < ANIMATE_WINDOW_MS);
    }
}

function applySnapshot(snap) {
    S.strategy = snap.strategy;
    S.unroutable = snap.unroutable;
    S.clockOffset = snap.at - Date.now();
    const seen = new Set();

    snap.backends.forEach(function (sb) {
        seen.add(sb.id);
        let b = S.backends.get(sb.id);
        if (!b) {
            b = newBackend(sb);
            S.backends.set(sb.id, b);
            if (scene3d) { scene3d.backendAppeared(b, false); }
        }
        copyCounters(b, sb, snap.at);
        if (sb.removed && !b.removed) {
            b.removed = sb.removed;
            if (scene3d) { scene3d.backendRemoved(b); }
        }
    });

    S.backends.forEach(function (b) {
        if (!seen.has(b.id) && !b.removed) {
            b.removed = { at: serverNow(), reason: "deregistered" };
            if (scene3d) { scene3d.backendRemoved(b); }
        }
    });

    S.pending.clear();
    if (scene3d) { scene3d.resync(); }
    handleHash();
}

function applyEvent(ev, animate) {
    switch (ev.type) {
        case "backendAdded": {
            const info = ev.backend;
            const previous = S.backends.get(info.id);
            if (previous && scene3d) { scene3d.dropBackend(previous); }
            const b = newBackend({ id: info.id, url: info.url, source: info.source, addedAt: ev.at, expiresAt: ev.expiresAt });
            if (ev.expiresAt) { b.leaseTtl = Math.max(1, ev.expiresAt - ev.at); }
            S.backends.set(info.id, b);
            logRegistration(ev.at, "joined", info.id + " joined (" + info.source + ") " + info.url);
            if (scene3d) { scene3d.backendAppeared(b, animate); }
            handleHash();
            break;
        }
        case "backendRemoved": {
            const b = S.backends.get(ev.backendId);
            if (!b) { break; }
            b.removed = { at: ev.at, reason: ev.reason };
            logRegistration(ev.at, ev.reason, ev.backendId + (ev.reason === "expired" ? " lease expired" : " deregistered"));
            if (scene3d) { scene3d.backendRemoved(b); }
            break;
        }
        case "leaseRenewed": {
            const b = S.backends.get(ev.backendId);
            if (!b) { break; }
            b.expiresAt = ev.expiresAt;
            logRegistration(ev.at, "renewed", ev.backendId + " renewed lease");
            if (scene3d) { scene3d.leaseRenewed(b); }
            break;
        }
        case "dispatched": onDispatched(ev, animate); break;
        case "completed": onSettled(ev, "completed", animate); break;
        case "failed": onSettled(ev, "failed", animate); break;
        case "aborted": onSettled(ev, "aborted", animate); break;
    }
}

function onDispatched(ev, animate) {
    S.pending.set(ev.requestId, { backendId: ev.backendId, method: ev.method, path: ev.path, at: ev.at });
    S.dispatchStamps.push(performance.now());
    if (S.dispatchStamps.length > STAMP_LIMIT) { S.dispatchStamps.splice(0, S.dispatchStamps.length - STAMP_LIMIT); }
    const b = S.backends.get(ev.backendId);
    if (!b) { return; }
    b.total++;
    b.inFlight++;
    if (animate) {
        addRequestRow(ev, b);
        if (scene3d) { scene3d.spawn(b, ev.requestId); }
    }
}

function onSettled(ev, kind, animate) {
    const p = S.pending.get(ev.requestId);
    S.pending.delete(ev.requestId);

    if (kind === "failed" && !ev.backendId) {
        S.unroutable++;
        if (animate) {
            addUnroutableRow(ev);
            if (scene3d) { scene3d.unroutable(); }
        }
        return;
    }

    const b = S.backends.get(ev.backendId);
    if (!b) { return; }

    b.inFlight = Math.max(0, b.inFlight - 1);
    const method = p ? p.method : "?";
    const path = p ? p.path : "?";
    const status = kind === "completed" ? ev.status : null;
    const isError = kind === "failed" || (kind === "completed" && ev.status >= 500);

    if (kind === "completed") {
        b.completed++;
        b.sc[statusClassOf(ev.status)]++;
        b.latSum += ev.durationMs;
        b.lastMs = ev.durationMs;
    } else if (kind === "failed") {
        b.failed++;
    } else {
        b.aborted++;
    }

    if (kind !== "aborted") { b.errEwma = b.errEwma * 0.9 + (isError ? 0.1 : 0); }

    const call = {
        requestId: ev.requestId, method: method, path: path,
        route: ev.route || normalizePath(path), guessedRoute: !ev.route,
        outcome: kind, status: status, durationMs: ev.durationMs === undefined ? null : ev.durationMs,
        phase: ev.phase || null, at: ev.at
    };

    updateRequestRow(call);
    recordDrillCall(b, call);
    if (scene3d) { scene3d.settle(b, call, animate); }
}

/* ------------------------------------------------------------ top bar */

function renderTop() {
    setText($("strategy"), S.strategy);
    const conn = $("conn");
    setText(conn, S.connected ? "live" : "reconnecting");
    conn.className = "pill " + (S.connected ? "on" : "off");

    const cutoff = performance.now() - 5000;
    while (S.dispatchStamps.length > 0 && S.dispatchStamps[0] < cutoff) { S.dispatchStamps.shift(); }
    setText($("rate"), (S.dispatchStamps.length / 5).toFixed(1));

    let live = 0;
    S.backends.forEach(function (b) { if (!b.removed) { live++; } });
    setText($("count"), String(live));
    setText($("unroutable"), String(S.unroutable));
}

/* ------------------------------------------------------ counters table */

const backendRows = new Map();
let backendOrder = "";

function makeBackendRow(b) {
    const cells = {};
    const tr = h("tr", { class: "clickable", "data-id": b.id });
    const name = h("td", { class: "l" });
    cells.name = h("span", { text: b.id });
    cells.badge = h("span", { class: "badge", text: b.source === "static" ? "pinned" : "lease" });
    name.append(cells.name, cells.badge);
    tr.append(name);
    ["total", "inFlight", "c2", "c3", "c4", "c5", "failed", "avg", "last", "lease"].forEach(function (key) {
        cells[key] = h("td");
        tr.append(cells[key]);
    });
    cells.c2.className = "c2"; cells.c3.className = "c3"; cells.c4.className = "c4"; cells.c5.className = "c5";
    cells.failed.className = "cf";
    return { tr: tr, cells: cells };
}

function updateBackendRow(row, b) {
    const c = row.cells;
    setText(c.total, String(b.total));
    setText(c.inFlight, String(b.inFlight));
    setText(c.c2, String(b.sc["2xx"]));
    setText(c.c3, String(b.sc["3xx"]));
    setText(c.c4, String(b.sc["4xx"]));
    setText(c.c5, String(b.sc["5xx"]));
    setText(c.failed, String(b.failed));
    setText(c.avg, b.completed ? fmtMs(b.latSum / b.completed) : "-");
    setText(c.last, fmtMs(b.lastMs));

    let lease;
    if (b.removed) { lease = (b.removed.reason === "expired" ? "expired " : "left ") + fmtTime(b.removed.at); }
    else if (b.source === "static" || !b.expiresAt) { lease = "pinned"; }
    else { lease = Math.max(0, Math.ceil((b.expiresAt - serverNow()) / 1000)) + " s"; }
    setText(c.lease, lease);

    row.tr.classList.toggle("gone", !!b.removed);
    row.tr.classList.toggle("focused", S.focusId === b.id);
}

function renderBackends() {
    const list = Array.from(S.backends.values()).sort(function (a, b) { return a.addedAt - b.addedAt; });
    $("backendsEmpty").hidden = list.length > 0;

    const body = $("backendsBody");
    const ids = new Set();
    list.forEach(function (b) {
        ids.add(b.id);
        let row = backendRows.get(b.id);
        if (!row) { row = makeBackendRow(b); backendRows.set(b.id, row); backendOrder = ""; }
        updateBackendRow(row, b);
    });

    backendRows.forEach(function (row, id) {
        if (!ids.has(id)) { row.tr.remove(); backendRows.delete(id); }
    });

    const order = list.map(function (b) { return b.id; }).join("|");
    if (order !== backendOrder) {
        backendOrder = order;
        list.forEach(function (b) { body.appendChild(backendRows.get(b.id).tr); });
    }
}

/* -------------------------------------------------------------- logs */

function prependLimited(container, el) {
    container.prepend(el);
    while (container.children.length > LOG_LIMIT) {
        const last = container.lastElementChild;
        if (last && last.dataset.reqid) { S.requestRows.delete(last.dataset.reqid); }
        container.removeChild(last);
    }
}

function addRequestRow(ev, b) {
    const parts = {
        s: h("span", { class: "s dim", text: "..." }),
        d: h("span", { class: "d", text: "" })
    };
    const row = h("div", { class: "row", "data-reqid": ev.requestId },
        h("span", { class: "t", text: fmtTime(ev.at) }),
        h("span", { class: "p", text: ev.method + " " + ev.path + "  ->  " + b.id }),
        parts.s, parts.d);
    S.requestRows.set(ev.requestId, parts);
    prependLimited($("requestLog"), row);
}

function updateRequestRow(call) {
    const parts = S.requestRows.get(call.requestId);
    if (!parts) { return; }
    if (call.outcome === "completed") {
        parts.s.textContent = String(call.status);
        parts.s.className = "s " + statusCss(call.status, false);
        parts.d.textContent = fmtMs(call.durationMs);
    } else if (call.outcome === "failed") {
        parts.s.textContent = "fail";
        parts.s.className = "s cf";
        parts.d.textContent = call.phase || "";
    } else {
        parts.s.textContent = "abort";
        parts.s.className = "s c4";
    }
}

function addUnroutableRow(ev) {
    const row = h("div", { class: "row" },
        h("span", { class: "t", text: fmtTime(ev.at) }),
        h("span", { class: "p", text: "no backend available" }),
        h("span", { class: "s cf", text: "503" }),
        h("span", { class: "d", text: "" }));
    prependLimited($("requestLog"), row);
}

function logRegistration(at, kind, text) {
    const cls = kind === "joined" ? "c2" : kind === "expired" ? "c5" : kind === "deregistered" ? "c4" : "dim";
    const row = h("div", { class: "row" },
        h("span", { class: "t", text: fmtTime(at) }),
        h("span", { class: "p " + cls, text: text }));
    prependLimited($("regLog"), row);
}

/* ------------------------------------------------------------ drill-down */

const routeRows = new Map();
let tailRows = [];

function newDetail(id) {
    return {
        id: id, routes: new Map(), tail: [], buffered: [], paused: false,
        filter: "", selected: null, loaded: false, timer: null, missing: false
    };
}

function focusBackend(id) {
    const b = S.backends.get(id);
    if (!b || S.focusId === id) { return; }
    leaveDetail();

    S.focusId = id;
    S.routeFilter = null;
    S.hoverRoute = null;
    S.detail = newDetail(id);
    $("tailFilter").value = "";
    $("pauseBtn").textContent = "Pause";
    $("drill").classList.add("show");
    clearRouteRows();
    clearTail();
    hideCallDetail();

    fetchDetail();
    S.detail.timer = setInterval(fetchDetail, DETAIL_REFRESH_MS);
    if (scene3d) { scene3d.focus(b); }
    history.replaceState(null, "", "#backend=" + encodeURIComponent(id));
    renderAll();
}

function leaveDetail() {
    if (S.detail && S.detail.timer) { clearInterval(S.detail.timer); }
    S.detail = null;
}

function unfocus() {
    if (S.focusId === null) { return; }
    leaveDetail();
    S.focusId = null;
    S.routeFilter = null;
    S.hoverRoute = null;
    $("drill").classList.remove("show");
    if (scene3d) { scene3d.unfocus(); }
    history.replaceState(null, "", location.pathname + location.search);
    renderAll();
}

function handleHash() {
    const match = /backend=([^&]+)/.exec(location.hash);
    if (!match) { return; }
    const id = decodeURIComponent(match[1]);
    if (S.focusId !== id && S.backends.has(id)) { focusBackend(id); }
}

async function fetchDetail() {
    const detail = S.detail;
    if (!detail || detail.missing) { return; }
    try {
        const res = await fetch(BASE + "/backends/" + encodeURIComponent(detail.id), { cache: "no-store" });
        if (S.detail !== detail) { return; }
        if (res.status === 404) { detail.missing = true; return; }
        if (!res.ok) { return; }
        mergeDetail(detail, await res.json());
    } catch (e) { /* the next refresh will try again */ }
}

function mergeDetail(detail, d) {
    d.routes.forEach(function (r) {
        const existing = detail.routes.get(r.key);
        const entry = existing || { stamps: [] };
        entry.key = r.key; entry.method = r.method; entry.route = r.route; entry.guessed = r.guessed;
        entry.count = r.count; entry.errors = r.errors;
        entry.avgMs = r.avgMs; entry.p95Ms = r.p95Ms; entry.p99Ms = r.p99Ms;
        detail.routes.set(r.key, entry);
    });

    if (!detail.loaded) {
        detail.loaded = true;
        detail.tail = d.recentCalls.map(function (c) {
            return {
                requestId: c.requestId, method: c.method, path: c.path, route: c.route, guessedRoute: c.guessedRoute,
                outcome: c.outcome, status: c.status === undefined ? null : c.status,
                durationMs: c.durationMs === undefined ? null : c.durationMs, phase: c.phase || null, at: c.at
            };
        });
        rebuildTail();
    }
    if (scene3d) { scene3d.routesChanged(); }
}

function recordDrillCall(b, call) {
    const detail = S.detail;
    if (!detail || detail.id !== b.id) { return; }

    if (call.outcome !== "aborted") {
        const key = call.method + " " + call.route;
        let r = detail.routes.get(key);
        if (!r) {
            r = { key: key, method: call.method, route: call.route, guessed: call.guessedRoute, count: 0, errors: 0, avgMs: 0, p95Ms: 0, p99Ms: 0, stamps: [] };
            detail.routes.set(key, r);
        }
        r.count++;
        if (call.outcome === "failed" || call.status >= 500) { r.errors++; }
        if (call.durationMs !== null) { r.avgMs = r.avgMs + (call.durationMs - r.avgMs) / r.count; }
        if (!call.guessedRoute) { r.guessed = false; }
        r.stamps.push(performance.now());
        if (r.stamps.length > STAMP_LIMIT) { r.stamps.splice(0, r.stamps.length - STAMP_LIMIT); }
        if (scene3d) { scene3d.routesChanged(); }
    }

    if (!detail.loaded) { return; }

    if (detail.paused) {
        detail.buffered.push(call);
        if (detail.buffered.length > PAUSED_BUFFER_LIMIT) { detail.buffered.shift(); }
        return;
    }
    pushTail(call);
}

function pushTail(call) {
    const detail = S.detail;
    detail.tail.unshift(call);
    if (detail.tail.length > TAIL_DATA_LIMIT) { detail.tail.length = TAIL_DATA_LIMIT; }
    if (callMatches(call)) { prependTailRow(call); }
}

function callMatches(call) {
    if (S.routeFilter && (call.method + " " + call.route) !== S.routeFilter) { return false; }
    const filter = S.detail.filter.trim().toLowerCase();
    if (!filter) { return true; }
    const hay = (call.method + " " + call.path + " " + (call.status === null ? "" : call.status + " " + statusClassOf(call.status)) +
        " " + (call.phase || "") + " " + call.outcome).toLowerCase();
    return filter.split(/\s+/).every(function (token) { return hay.indexOf(token) !== -1; });
}

function makeTailRow(call) {
    const statusText = call.outcome === "completed" ? String(call.status) : call.outcome === "failed" ? "fail" : "abort";
    const statusClass = call.outcome === "completed" ? statusCss(call.status, false) : call.outcome === "failed" ? "cf" : "c4";
    const detailText = call.durationMs !== null ? fmtMs(call.durationMs) : (call.phase || "");
    const row = h("div", { class: "row clickable" },
        h("span", { class: "t", text: fmtTime(call.at) }),
        h("span", { class: "p", text: call.method + " " + call.path }),
        h("span", { class: "s " + statusClass, text: statusText }),
        h("span", { class: "d", text: detailText }));
    row.addEventListener("click", function () { selectCall(call, row); });
    return row;
}

function prependTailRow(call) {
    const row = makeTailRow(call);
    const tail = $("tail");
    tail.prepend(row);
    tailRows.unshift(row);
    while (tailRows.length > TAIL_DOM_LIMIT) { tailRows.pop().remove(); }
    $("tailEmpty").hidden = true;
}

function clearTail() {
    $("tail").textContent = "";
    tailRows = [];
    $("tailEmpty").hidden = false;
}

function rebuildTail() {
    clearTail();
    const detail = S.detail;
    if (!detail) { return; }
    let shown = 0;
    for (let i = 0; i < detail.tail.length && shown < TAIL_DOM_LIMIT; i++) {
        const call = detail.tail[i];
        if (!callMatches(call)) { continue; }
        const row = makeTailRow(call);
        $("tail").append(row);
        tailRows.push(row);
        shown++;
    }
    $("tailEmpty").hidden = shown > 0;
}

function selectCall(call, row) {
    tailRows.forEach(function (r) { r.classList.remove("selected"); });
    row.classList.add("selected");
    S.detail.selected = call;

    const b = S.backends.get(S.detail.id);
    const box = $("callDetail");
    const list = h("dl");
    const add = function (name, value) { list.append(h("dt", { text: name }), h("dd", { text: value })); };
    add("Request id", call.requestId);
    add("Time", new Date(call.at).toISOString());
    add("Backend", b ? b.id + "  " + b.url : S.detail.id);
    add("Method", call.method);
    add("Path", call.path);
    add("Route", call.route + (call.guessedRoute ? "  (guessed)" : ""));
    add("Outcome", call.outcome);
    if (call.status !== null) { add("Status", String(call.status)); }
    if (call.durationMs !== null) { add("Duration", fmtMs(call.durationMs)); }
    if (call.phase) { add("Failed at", call.phase); }
    box.textContent = "";
    box.append(list);
    box.hidden = false;
}

function hideCallDetail() { $("callDetail").hidden = true; }

function clearRouteRows() {
    routeRows.forEach(function (row) { row.tr.remove(); });
    routeRows.clear();
}

function renderDrill() {
    const detail = S.detail;
    const b = detail ? S.backends.get(detail.id) : null;
    if (!detail || !b) { return; }

    setText($("drillId"), b.id);
    setText($("drillSource"), b.source === "static" ? "pinned" : "registered");

    const lease = b.removed ? "" : b.source === "static" || !b.expiresAt ? "pinned" :
        "lease " + Math.max(0, Math.ceil((b.expiresAt - serverNow()) / 1000)) + " s";
    const avg = b.completed ? fmtMs(b.latSum / b.completed) : "-";
    setText($("drillMeta"), [b.url, lease, "total " + b.total, "in-flight " + b.inFlight, "avg " + avg,
        "2xx " + b.sc["2xx"] + "  4xx " + b.sc["4xx"] + "  5xx " + b.sc["5xx"] + "  fail " + b.failed]
        .filter(function (x) { return x; }).join("   -   "));

    const banner = $("drillBanner");
    if (b.removed) {
        banner.hidden = false;
        setText(banner, (b.removed.reason === "expired" ? "Expired " : "Deregistered ") + fmtTime(b.removed.at) + " - final stats");
    } else {
        banner.hidden = true;
    }

    renderRoutes();

    const chip = $("routeChip");
    if (S.routeFilter) { chip.hidden = false; setText(chip, "route: " + S.routeFilter + "  x"); }
    else { chip.hidden = true; }

    const pause = $("pauseBtn");
    setText(pause, detail.paused ? "Resume (" + detail.buffered.length + ")" : "Pause");
}

function routeRate(r) {
    const cutoff = performance.now() - RATE_WINDOW_MS;
    while (r.stamps.length > 0 && r.stamps[0] < cutoff) { r.stamps.shift(); }
    return r.stamps.length / (RATE_WINDOW_MS / 1000);
}

function makeRouteRow(r) {
    const cells = {};
    const tr = h("tr", { class: "clickable", "data-key": r.key });
    ["method", "route", "count", "rate", "err", "avg", "p95", "p99"].forEach(function (key) {
        cells[key] = h("td", { class: key === "method" || key === "route" ? "l" : "" });
        tr.append(cells[key]);
    });
    tr.addEventListener("mouseenter", function () { setHoverRoute(r.key, true); });
    tr.addEventListener("mouseleave", function () { setHoverRoute(null, true); });
    tr.addEventListener("click", function () {
        S.routeFilter = S.routeFilter === r.key ? null : r.key;
        rebuildTail();
        renderDrill();
    });
    return { tr: tr, cells: cells };
}

function renderRoutes() {
    const detail = S.detail;
    const rows = Array.from(detail.routes.values());
    $("routeEmpty").hidden = rows.length > 0;

    const value = function (r) {
        switch (S.sortKey) {
            case "method": return r.method;
            case "route": return r.route;
            case "rate": return routeRate(r);
            case "err": return r.count ? r.errors / r.count : 0;
            case "avg": return r.avgMs;
            case "p95": return r.p95Ms;
            case "p99": return r.p99Ms;
            default: return r.count;
        }
    };
    rows.sort(function (a, b) {
        const x = value(a), y = value(b);
        const order = x < y ? -1 : x > y ? 1 : 0;
        return order * S.sortDir || b.count - a.count;
    });

    const body = $("routeBody");
    let orderChanged = false;

    rows.forEach(function (r, index) {
        let row = routeRows.get(r.key);
        if (!row) { row = makeRouteRow(r); routeRows.set(r.key, row); orderChanged = true; }
        const c = row.cells;
        setText(c.method, r.method || "-");
        setText(c.route, (r.guessed ? "~ " : "") + r.route);
        c.route.className = "l trunc" + (r.guessed ? " guess" : "");
        setText(c.count, String(r.count));
        setText(c.rate, routeRate(r).toFixed(1));
        setText(c.err, r.count ? ((r.errors / r.count) * 100).toFixed(0) + "%" : "-");
        c.err.className = r.errors > 0 ? "c5" : "";
        setText(c.avg, fmtMs(r.avgMs));
        setText(c.p95, fmtMs(r.p95Ms));
        setText(c.p99, fmtMs(r.p99Ms));
        row.tr.classList.toggle("hover", S.hoverRoute === r.key);
        row.tr.classList.toggle("selected", S.routeFilter === r.key);
        if (!orderChanged && body.children[index] !== row.tr) { orderChanged = true; }
    });

    if (orderChanged) { rows.forEach(function (r) { body.appendChild(routeRows.get(r.key).tr); }); }
}

/* Hover is shared between the route table and the 3D constellation: two views of the same data. */
function setHoverRoute(key, fromTable) {
    if (S.hoverRoute === key) { return; }
    S.hoverRoute = key;
    routeRows.forEach(function (row, k) { row.tr.classList.toggle("hover", k === key); });
    if (scene3d && fromTable) { scene3d.hoverChanged(); }
}

function renderAll() {
    renderTop();
    renderBackends();
    if (S.detail) { renderDrill(); }
}

/* ----------------------------------------------------------------- wiring */

$("backendsBody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (tr) { focusBackend(tr.dataset.id); }
});
$("drillBack").addEventListener("click", unfocus);
$("routeChip").addEventListener("click", function () { S.routeFilter = null; rebuildTail(); renderDrill(); });
$("pauseBtn").addEventListener("click", function () {
    const detail = S.detail;
    if (!detail) { return; }
    detail.paused = !detail.paused;
    if (!detail.paused) {
        detail.buffered.forEach(pushTail);
        detail.buffered = [];
    }
    renderDrill();
});
$("tailFilter").addEventListener("input", function (e) {
    if (S.detail) { S.detail.filter = e.target.value; rebuildTail(); }
});
document.querySelectorAll("th.sortable").forEach(function (th) {
    th.addEventListener("click", function () {
        const key = th.dataset.key;
        if (S.sortKey === key) { S.sortDir = -S.sortDir; } else { S.sortKey = key; S.sortDir = key === "method" || key === "route" ? 1 : -1; }
        if (S.detail) { renderRoutes(); }
    });
});
window.addEventListener("keydown", function (e) { if (e.key === "Escape") { unfocus(); } });
window.addEventListener("hashchange", handleHash);

/* Removed backends stay visible for a while so their final numbers can be read, then go. */
setInterval(function () {
    const now = serverNow();
    S.backends.forEach(function (b, id) {
        if (b.removed && now - b.removed.at > REMOVED_KEEP_MS && S.focusId !== id) {
            if (scene3d) { scene3d.dropBackend(b); }
            S.backends.delete(id);
        }
    });
}, 2000);

/* Timers still run in a hidden tab (slowly); rAF does not - so this keeps the queue from growing unbounded. */
setInterval(function () { if (document.hidden) { drainQueue(); renderAll(); } }, 1000);
`;
