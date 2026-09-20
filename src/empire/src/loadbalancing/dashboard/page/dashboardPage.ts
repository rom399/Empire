import { DASHBOARD_OVERLAY_SCRIPT } from "./dashboardOverlayScript";
import { DASHBOARD_SCENE_SCRIPT } from "./dashboardSceneScript";
import { DASHBOARD_STYLES } from "./dashboardStyles";
import { DashboardPageOptions } from "./DashboardPageOptions";

/**
 * Renders the dashboard as one self-contained HTML document: styles,
 * markup, an import map for three.js, and the client script, all inline. A
 * string served straight from a .ts file, so there is no build step and
 * nothing extra to ship in the npm package.
 *
 * The client script gets its two runtime values as JSON string literals,
 * with "<" escaped so a hostile value can never close the script element.
 */
export function renderDashboardPage(options: DashboardPageOptions): string {
    const basePath = toScriptLiteral(options.basePath);
    const threeBase = toScriptLiteral(options.threeBaseUrl);

    const importMap = JSON.stringify({
        imports: {
            three: `${options.threeBaseUrl}build/three.module.js`,
            "three/addons/": `${options.threeBaseUrl}examples/jsm/`,
        },
    }).replace(/</g, "\\u003c");

    const script = (DASHBOARD_OVERLAY_SCRIPT + DASHBOARD_SCENE_SCRIPT)
        .replace("__BASE_PATH__", () => basePath)
        .replace("__THREE_BASE__", () => threeBase);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Empire load balancer</title>
<style>${DASHBOARD_STYLES}</style>
<script type="importmap">${importMap}</script>
</head>
<body>
<div id="scene"></div>

<header id="topbar" class="panel">
    <h1>Empire load balancer</h1>
    <span class="pill" id="strategy">-</span>
    <span class="pill" id="conn">connecting</span>
    <span class="stat">backends <b id="count">0</b></span>
    <span class="stat">req/s <b id="rate">0.0</b></span>
    <span class="stat">no backend (503) <b id="unroutable">0</b></span>
    <span class="spacer"></span>
    <span id="notice"></span>
</header>

<aside id="backends" class="panel">
    <table>
        <thead><tr>
            <th class="l">Backend</th><th>Total</th><th>In-flight</th>
            <th>2xx</th><th>3xx</th><th>4xx</th><th>5xx</th><th>Failed</th><th>Avg</th><th>Last</th><th>Lease</th>
        </tr></thead>
        <tbody id="backendsBody"></tbody>
    </table>
    <div class="empty" id="backendsEmpty" style="padding: 10px 14px">Waiting for backends to register...</div>
</aside>

<aside id="drill" class="panel">
    <header>
        <button class="link" id="drillBack" type="button">&larr; all backends</button>
        <div class="title"><span id="drillId"></span><span class="badge" id="drillSource"></span></div>
        <div class="meta" id="drillMeta"></div>
        <div class="banner" id="drillBanner" hidden></div>
    </header>
    <div class="body">
        <h2>Routes</h2>
        <table>
            <thead><tr>
                <th class="l sortable" data-key="method">Method</th>
                <th class="l sortable" data-key="route">Route</th>
                <th class="sortable" data-key="count">Count</th>
                <th class="sortable" data-key="rate">req/s</th>
                <th class="sortable" data-key="err">Err</th>
                <th class="sortable" data-key="avg">Avg</th>
                <th class="sortable" data-key="p95">p95</th>
                <th class="sortable" data-key="p99">p99</th>
            </tr></thead>
            <tbody id="routeBody"></tbody>
        </table>
        <div class="empty" id="routeEmpty">No calls yet.</div>

        <h2 style="margin-top: 14px">Calls</h2>
        <div class="tools">
            <button id="pauseBtn" type="button">Pause</button>
            <input id="tailFilter" type="search" placeholder="Filter: GET, 5xx, /cart" autocomplete="off">
            <span class="chip" id="routeChip" hidden></span>
        </div>
        <div id="tail"></div>
        <div class="empty" id="tailEmpty">No calls yet.</div>
        <div id="callDetail" hidden></div>
    </div>
</aside>

<footer id="logs" class="panel">
    <section><h2>Requests</h2><div id="requestLog"></div></section>
    <section><h2>Registrations</h2><div id="regLog"></div></section>
</footer>

<script type="module">${script}</script>
</body>
</html>
`;
}

/** A JSON string literal that is also safe to embed inside a script element. */
function toScriptLiteral(value: string): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}
