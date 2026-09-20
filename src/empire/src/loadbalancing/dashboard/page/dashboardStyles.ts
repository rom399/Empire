/**
 * The dashboard's stylesheet. Colours are tokens on :root, redefined under
 * prefers-color-scheme, so the overlay and the 3D scene's background both
 * follow the viewer's theme.
 */
export const DASHBOARD_STYLES = String.raw`
:root {
    --bg: #eef1f6;
    --panel: rgba(255, 255, 255, 0.9);
    --panel-solid: #ffffff;
    --ink: #1c2230;
    --muted: #667088;
    --line: #d8dde7;
    --accent: #2f6df6;
    --ok: #1e9e5a;
    --info: #2f80ed;
    --warn: #d98c00;
    --bad: #d64545;
    --row-hover: rgba(47, 109, 246, 0.08);
    --row-focus: rgba(47, 109, 246, 0.16);
    --shadow: 0 6px 24px rgba(20, 30, 60, 0.14);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color-scheme: light;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #0b0f16;
        --panel: rgba(20, 25, 35, 0.88);
        --panel-solid: #141923;
        --ink: #e6e9ef;
        --muted: #93a0b8;
        --line: #283044;
        --accent: #6f9bff;
        --ok: #37c47c;
        --info: #5b9dff;
        --warn: #f0a92b;
        --bad: #f26b6b;
        --row-hover: rgba(111, 155, 255, 0.1);
        --row-focus: rgba(111, 155, 255, 0.2);
        --shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
        color-scheme: dark;
    }
}

* { box-sizing: border-box; }

html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--ink);
    font-size: 13px;
}

#scene { position: fixed; inset: 0; }
#scene canvas { display: block; }
#scene .labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

.lbl {
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    font-size: 11px;
    line-height: 1.3;
    white-space: nowrap;
    text-align: center;
    transition: opacity 0.3s;
}
.lbl b { font-weight: 600; }
.lbl span { color: var(--muted); margin-left: 5px; }
.lbl.route { font-size: 10px; }
.lbl.hub { font-weight: 600; letter-spacing: 0.02em; }

.panel {
    position: absolute;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(6px);
}

#topbar {
    top: 12px; left: 12px; right: 12px;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 8px 14px;
    pointer-events: auto;
}
#topbar h1 { margin: 0; font-size: 14px; font-weight: 650; }
.pill { padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); font-size: 11.5px; color: var(--muted); }
.pill.on { color: var(--ok); border-color: var(--ok); }
.pill.off { color: var(--bad); border-color: var(--bad); }
.stat { color: var(--muted); }
.stat b { color: var(--ink); font-variant-numeric: tabular-nums; }
.spacer { flex: 1; }

#notice { display: none; color: var(--warn); }
#notice.show { display: inline; }

#backends { top: 64px; left: 12px; max-width: min(760px, calc(100vw - 24px)); max-height: 42vh; overflow: auto; }
#drill { top: 64px; right: 12px; width: min(560px, calc(100vw - 24px)); bottom: 178px; display: none; flex-direction: column; overflow: hidden; }
#drill.show { display: flex; }
#logs { left: 12px; right: 12px; bottom: 12px; height: 154px; display: grid; grid-template-columns: 3fr 2fr; overflow: hidden; }
#logs > section { overflow: auto; padding: 6px 10px; min-width: 0; }
#logs > section + section { border-left: 1px solid var(--line); }

h2 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }

table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 4px 8px; text-align: right; white-space: nowrap; }
th:first-child, td:first-child, th.l, td.l { text-align: left; }
th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--panel-solid); }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--ink); }
tbody tr { border-top: 1px solid var(--line); }
tbody tr.clickable { cursor: pointer; }
tbody tr.clickable:hover, tbody tr.hover { background: var(--row-hover); }
tbody tr.focused, tbody tr.selected { background: var(--row-focus); }
tbody tr.gone { opacity: 0.5; }
td.trunc { max-width: 210px; overflow: hidden; text-overflow: ellipsis; }

.badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); margin-left: 6px; }
.c2 { color: var(--ok); } .c3 { color: var(--info); } .c4 { color: var(--warn); } .c5, .cf { color: var(--bad); }
.dim { color: var(--muted); }
.guess { color: var(--muted); }

.row { display: flex; align-items: baseline; gap: 8px; padding: 1px 0; font-size: 12px; font-variant-numeric: tabular-nums; min-width: 0; }
.row .t { color: var(--muted); flex: none; }
.row .p { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .s { flex: none; min-width: 3ch; text-align: right; }
.row .d { flex: none; min-width: 6ch; text-align: right; color: var(--muted); }
.row.clickable { cursor: pointer; }
.row.clickable:hover { background: var(--row-hover); }
.row.selected { background: var(--row-focus); }

button, input {
    font: inherit; color: var(--ink); background: var(--panel-solid);
    border: 1px solid var(--line); border-radius: 6px; padding: 3px 9px;
}
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.link { border: 0; background: none; color: var(--accent); padding: 0; }
input { min-width: 0; }

#drill header { padding: 10px 14px 8px; border-bottom: 1px solid var(--line); }
#drill header .title { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 15px; font-weight: 650; }
#drill header .meta { color: var(--muted); margin-top: 3px; font-variant-numeric: tabular-nums; }
#drill .banner { margin-top: 8px; padding: 5px 9px; border-radius: 6px; background: rgba(214, 69, 69, 0.13); color: var(--bad); }
#drill .body { flex: 1; overflow: auto; padding: 8px 14px 12px; min-height: 0; }
#drill .tools { display: flex; gap: 8px; align-items: center; margin: 4px 0 6px; }
#drill .tools input { flex: 1; }
#drill .chip { padding: 1px 8px; border-radius: 999px; background: var(--row-focus); font-size: 11.5px; }
#callDetail { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }
#callDetail dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
#callDetail dt { color: var(--muted); }
#callDetail dd { margin: 0; overflow-wrap: anywhere; }
.empty { color: var(--muted); padding: 8px 2px; }

@media (max-width: 820px) {
    #topbar { top: 8px; left: 8px; right: 8px; gap: 8px; padding: 6px 10px; }
    #topbar h1 { display: none; }
    #backends { top: 52px; left: 8px; }
    #logs { grid-template-columns: 1fr; height: 120px; }
    #logs > section + section { display: none; }
    #drill { top: auto; bottom: 144px; height: 52vh; }
    #backends { max-height: 30vh; }
}

@media (prefers-reduced-motion: reduce) {
    .lbl { transition: none; }
}
`;
