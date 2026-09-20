/**
 * Second half of the dashboard's client script: the three.js scene. It runs
 * in the same module scope as DASHBOARD_OVERLAY_SCRIPT and reads its state
 * (S) and helpers directly; the overlay talks to it only through the
 * object createScene() returns, and treats a null result - three.js or
 * WebGL unavailable - as "overlay only". Same String.raw authoring rules
 * as the overlay script: no backticks, no "${".
 *
 * The scene: the balancer is a hub at the centre; backends sit on a ring
 * around it, so round robin reads as a sweep around the circle. Each
 * request is a particle that flies hub -> backend along a Bezier arc, orbits
 * the node while in flight, then flashes its status colour. Focusing a
 * backend dims everything else and unfolds that backend into a
 * constellation of route satellites.
 */
export const DASHBOARD_SCENE_SCRIPT = String.raw`
const POOL_SIZE = 2048;
const FLY_SECONDS = 0.55;
const HOP_SECONDS = 0.35;
const FLASH_SECONDS = 0.6;
const HUB_HEIGHT = 1.1;
const MAX_SATELLITES = 12;
const SATELLITE_RING_RADIUS = 2.7;
const CONSTELLATION_REFRESH_S = 0.4;
const LEASE_ARC_SEGMENTS = 64;
const CAMERA_TWEEN_S = 0.6;
const FOCUS_DISTANCE = 11;
const FOCUS_HEIGHT = 7;
const IDLE_ROTATE_DELAY_MS = 6000;

const PHASE_FLY = 0, PHASE_ORBIT = 1, PHASE_HOP = 2, PHASE_FLASH = 3;

const COLOR = {
    ok: 0x2ecc71, info: 0x3b82f6, warn: 0xf5a524, bad: 0xef4444,
    dispatch: 0xcfd8e8, pinned: 0x7f8aa3, registered: 0x3b82f6,
    halo: 0x7dd3fc, lease: 0x9be36b, gone: 0x6b7280
};

function easeOutBack(t) { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function statusColor(status) {
    if (status >= 500) { return COLOR.bad; }
    if (status >= 400) { return COLOR.warn; }
    if (status >= 300) { return COLOR.info; }
    return COLOR.ok;
}

function portOf(url) {
    try { const u = new URL(url); return ":" + (u.port || "80"); } catch (e) { return ""; }
}

function showNotice(text) {
    const n = $("notice");
    n.textContent = text;
    n.classList.add("show");
}

async function createScene() {
    let THREE, OrbitControls, CSS2DRenderer, CSS2DObject;
    try {
        THREE = await import("three");
        OrbitControls = (await import("three/addons/controls/OrbitControls.js")).OrbitControls;
        const css = await import("three/addons/renderers/CSS2DRenderer.js");
        CSS2DRenderer = css.CSS2DRenderer;
        CSS2DObject = css.CSS2DObject;
    } catch (err) {
        showNotice("3D view unavailable - could not load three.js from " + THREE_BASE + ". The overlay still works.");
        return null;
    }

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
        showNotice("WebGL is not available in this browser. The overlay still works.");
        return null;
    }

    const container = $("scene");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.className = "labels";
    container.appendChild(labels.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 3;
    controls.maxDistance = 70;
    controls.autoRotate = !REDUCED_MOTION;
    controls.autoRotateSpeed = 0.5;

    let idleTimer = null;
    controls.addEventListener("start", function () {
        controls.autoRotate = false;
        clearTimeout(idleTimer);
    });
    controls.addEventListener("end", function () {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
            if (!REDUCED_MOTION && S.focusId === null) { controls.autoRotate = true; }
        }, IDLE_ROTATE_DELAY_MS);
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    function applyTheme() {
        const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#eef1f6";
        renderer.setClearColor(new THREE.Color(bg));
    }
    applyTheme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    /* ---- hub */

    const HUB = new THREE.Vector3(0, HUB_HEIGHT, 0);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x8fa8ff, emissive: 0x3b5bdb, emissiveIntensity: 0.6, roughness: 0.35 });
    const hub = new THREE.Mesh(new THREE.IcosahedronGeometry(HUB_HEIGHT, 1), hubMat);
    hub.position.copy(HUB);
    scene.add(hub);
    const hubLabelDiv = h("div", { class: "lbl hub", text: "balancer" });
    const hubLabel = new CSS2DObject(hubLabelDiv);
    hubLabel.position.set(0, HUB_HEIGHT + 0.8, 0);
    hub.add(hubLabel);
    let hubPulse = 0;
    let hubAlarm = 0;

    const ringGuide = new THREE.Mesh(
        new THREE.RingGeometry(0.985, 1, 160),
        new THREE.MeshBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    ringGuide.rotation.x = -Math.PI / 2;
    ringGuide.position.y = 0.01;
    scene.add(ringGuide);

    /* ---- backend nodes */

    const bodyGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 28);
    bodyGeo.translate(0, 0.5, 0);
    const haloGeo = new THREE.TorusGeometry(0.9, 0.035, 8, 56);
    const arcPoints = [];
    for (let i = 0; i <= LEASE_ARC_SEGMENTS; i++) {
        const a = (i / LEASE_ARC_SEGMENTS) * Math.PI * 2;
        arcPoints.push(new THREE.Vector3(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const RED = new THREE.Color(COLOR.bad);
    const GONE = new THREE.Color(COLOR.gone);
    const HALO = new THREE.Color(COLOR.halo);

    let ringRadius = 8;
    const tmpTop = new THREE.Vector3();

    function createView(b, animate) {
        const base = new THREE.Color(b.source === "static" ? COLOR.pinned : COLOR.registered);
        const group = new THREE.Group();

        const bodyMat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.5, metalness: 0.1, transparent: true });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.userData.backendId = b.id;
        group.add(body);

        const haloMat = new THREE.MeshBasicMaterial({ color: HALO.clone(), transparent: true, opacity: 0.15 });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.rotation.x = Math.PI / 2;
        group.add(halo);

        let arc = null, arcMat = null;
        if (b.source !== "static") {
            arcMat = new THREE.LineBasicMaterial({ color: COLOR.lease, transparent: true });
            arc = new THREE.Line(arcGeo.clone(), arcMat);
            arc.position.y = 0.04;
            group.add(arc);
        }

        const labelDiv = h("div", { class: "lbl" }, h("b", { text: b.id }), h("span", { text: portOf(b.url) }));
        const label = new CSS2DObject(labelDiv);
        group.add(label);

        const spokeMat = new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.25 });
        const spoke = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), spokeMat);
        scene.add(spoke);
        scene.add(group);

        return {
            group: group, body: body, bodyMat: bodyMat, halo: halo, haloMat: haloMat, arc: arc, arcMat: arcMat,
            label: label, labelDiv: labelDiv, spoke: spoke, spokeMat: spokeMat, base: base,
            angle: 0, targetAngle: 0, hasAngle: false, r: ringRadius,
            spawn: animate && !REDUCED_MOTION ? 0 : 1,
            height: 0.6, yScale: 1, flash: 0, flashColor: new THREE.Color(COLOR.info),
            arcFrac: 1, dim: 1, removing: null
        };
    }

    function disposeView(b) {
        const v = b.view;
        if (!v) { return; }
        scene.remove(v.group);
        scene.remove(v.spoke);
        v.bodyMat.dispose();
        v.haloMat.dispose();
        if (v.arc) { v.arc.geometry.dispose(); v.arcMat.dispose(); }
        v.spoke.geometry.dispose();
        v.spokeMat.dispose();
        v.labelDiv.remove();
        b.view = null;
    }

    function flashNode(b, color, strength) {
        if (!b.view) { return; }
        b.view.flash = Math.max(b.view.flash, strength);
        b.view.flashColor.setHex(color);
    }

    function nodeTop(b) {
        const v = b.view;
        return tmpTop.set(v.group.position.x, v.height * v.yScale * v.group.scale.y + 0.25, v.group.position.z);
    }

    function layoutRing(dt) {
        const live = [];
        S.backends.forEach(function (b) { if (b.view && !b.view.removing) { live.push(b); } });
        live.sort(function (a, b) { return a.addedAt - b.addedAt; });

        const n = live.length;
        ringRadius += (clamp(3.2 + n * 1.5, 7, 17) - ringRadius) * Math.min(1, dt * 3);

        live.forEach(function (b, i) {
            const v = b.view;
            v.targetAngle = -Math.PI / 2 + (Math.PI * 2 * i) / n;
            v.r = ringRadius;
            if (!v.hasAngle) { v.angle = v.targetAngle; v.hasAngle = true; return; }
            let d = v.targetAngle - v.angle;
            d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
            v.angle += d * Math.min(1, dt * 5);
        });
    }

    function updateView(b, dt) {
        const v = b.view;
        v.spawn = Math.min(1, v.spawn + dt / 0.6);
        let scale = easeOutBack(v.spawn);
        let opacity = 1;
        let grey = 0;
        v.yScale = 1;

        const r = v.removing;
        let shake = 0;
        if (r) {
            r.age += dt;
            /* Let requests already in flight land before the node visibly goes. */
            if (!(b.inFlight > 0 && r.age < 3)) { r.t = Math.min(1, r.t + dt / (r.reason === "expired" ? 1.1 : 1.8)); }
            grey = Math.min(1, r.age * 2);
            if (r.reason === "expired") {
                /* A crash: the node collapses and shakes. */
                v.yScale = Math.max(0.02, 1 - r.t * r.t);
                shake = (1 - r.t) * 0.06 * Math.sin(r.age * 45);
                scale *= 1 - 0.2 * r.t;
            } else {
                /* A clean shutdown: it just fades and shrinks away. */
                opacity = 1 - r.t;
                scale *= 1 - 0.35 * r.t;
            }
            if (r.t >= 1) { disposeView(b); return; }
        }

        const targetDim = S.focusId !== null && S.focusId !== b.id ? 0.22 : 1;
        v.dim += (targetDim - v.dim) * Math.min(1, dt * 5);
        const alpha = opacity * (0.25 + 0.75 * v.dim);

        v.height += (clamp(0.6 + Math.log2(1 + b.total) * 0.35, 0.6, 6.5) - v.height) * Math.min(1, dt * 4);
        v.flash = Math.max(0, v.flash - dt * 2.2);

        v.group.position.set(Math.cos(v.angle) * v.r + shake, 0, Math.sin(v.angle) * v.r);
        v.group.scale.setScalar(Math.max(0.001, scale));
        v.body.scale.y = v.height * v.yScale;

        v.bodyMat.color.copy(v.base).lerp(RED, clamp(b.errEwma * 2.5, 0, 1)).lerp(GONE, grey * 0.8);
        v.bodyMat.emissive.copy(v.flashColor);
        v.bodyMat.emissiveIntensity = v.flash * 0.9;
        v.bodyMat.opacity = alpha;

        v.halo.position.y = v.height * v.yScale + 0.12;
        v.haloMat.color.copy(HALO).lerp(v.flashColor, v.flash);
        v.haloMat.opacity = clamp(0.12 + 0.88 * Math.min(1, b.inFlight / 8) + v.flash * 0.5, 0, 1) * alpha;

        if (v.arc) {
            const target = b.removed || !b.expiresAt ? 0 : clamp((b.expiresAt - serverNow()) / b.leaseTtl, 0, 1);
            /* A renewal refills the arc smoothly; draining just follows the clock. */
            v.arcFrac = target > v.arcFrac ? v.arcFrac + (target - v.arcFrac) * Math.min(1, dt * 8) : target;
            v.arc.geometry.setDrawRange(0, Math.floor((LEASE_ARC_SEGMENTS + 1) * v.arcFrac));
            v.arcMat.color.setHSL(0.33 * v.arcFrac, 0.7, 0.55);
            v.arcMat.opacity = alpha;
        }

        v.label.position.set(0, v.height * v.yScale + 0.9, 0);
        v.labelDiv.style.opacity = String(Math.max(0.12, v.dim * opacity));

        const pos = v.spoke.geometry.attributes.position;
        pos.setXYZ(0, HUB.x, HUB.y, HUB.z);
        pos.setXYZ(1, v.group.position.x, 0.3, v.group.position.z);
        pos.needsUpdate = true;
        v.spokeMat.opacity = 0.25 * alpha;
    }

    /* ---- request particles */

    const particleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), POOL_SIZE);
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const dummy = new THREE.Object3D();
    const particles = [];
    const freeList = [];
    const particleOf = new Map();
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);

    for (let i = 0; i < POOL_SIZE; i++) {
        particles.push({
            active: false, dirty: true, phase: PHASE_FLY, t: 0, b: null, reqId: null, result: null, key: null,
            orbit: 0, sat: null, pos: new THREE.Vector3(), from: new THREE.Vector3(), color: new THREE.Color(0xffffff)
        });
        freeList.push(POOL_SIZE - 1 - i);
        particleMesh.setMatrixAt(i, hiddenMatrix);
        particleMesh.setColorAt(i, white);
    }

    function releaseParticle(i) {
        const p = particles[i];
        if (p.reqId !== null && particleOf.get(p.reqId) === i) { particleOf.delete(p.reqId); }
        p.active = false; p.dirty = true; p.b = null; p.reqId = null; p.sat = null; p.result = null;
        freeList.push(i);
    }

    function bezier(out, from, to, t) {
        const lift = 2.5 + from.distanceTo(to) * 0.22;
        const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2 + lift, cz = (from.z + to.z) / 2;
        const u = 1 - t;
        out.set(
            u * u * from.x + 2 * u * t * cx + t * t * to.x,
            u * u * from.y + 2 * u * t * cy + t * t * to.y,
            u * u * from.z + 2 * u * t * cz + t * t * to.z
        );
    }

    /* Once a particle knows how its request ended: hop to the route's satellite if that backend is focused, else flash in place. */
    function resolveParticle(p) {
        const sat = satelliteFor(p.b, p.key);
        p.t = 0;
        if (sat) {
            p.phase = PHASE_HOP;
            p.from.copy(p.pos);
            p.sat = sat;
            sat.pulse = 1;
        } else {
            p.phase = PHASE_FLASH;
            p.color.setHex(p.result);
        }
    }

    function updateParticles(dt) {
        for (let i = 0; i < POOL_SIZE; i++) {
            const p = particles[i];

            if (!p.active) {
                if (p.dirty) { particleMesh.setMatrixAt(i, hiddenMatrix); p.dirty = false; }
                continue;
            }

            if (!p.b || !p.b.view) { releaseParticle(i); continue; }
            let size = 1;

            if (p.phase === PHASE_FLY) {
                p.t += dt / FLY_SECONDS;
                bezier(p.pos, HUB, nodeTop(p.b), Math.min(p.t, 1));
                if (p.t >= 1) {
                    if (p.result !== null) { resolveParticle(p); } else { p.phase = PHASE_ORBIT; p.t = 0; }
                }
            } else if (p.phase === PHASE_ORBIT) {
                p.orbit += dt * 2.4;
                const top = nodeTop(p.b);
                p.pos.set(top.x + Math.cos(p.orbit) * 0.95, top.y + Math.sin(p.orbit * 2) * 0.06, top.z + Math.sin(p.orbit) * 0.95);
            } else if (p.phase === PHASE_HOP) {
                p.t += dt / HOP_SECONDS;
                const t = Math.min(p.t, 1);
                const target = satelliteWorld(p.sat);
                p.pos.lerpVectors(p.from, target, easeInOutCubic(t));
                p.pos.y += Math.sin(Math.PI * t) * 0.6;
                if (p.t >= 1) { p.phase = PHASE_FLASH; p.t = 0; p.color.setHex(p.result); }
            } else {
                p.t += dt / FLASH_SECONDS;
                if (p.t >= 1) { releaseParticle(i); continue; }
                if (p.sat) { p.pos.copy(satelliteWorld(p.sat)); }
                size = (1 + p.t * 1.8) * (1 - p.t * 0.9);
            }

            dummy.position.copy(p.pos);
            dummy.scale.setScalar(size);
            dummy.updateMatrix();
            particleMesh.setMatrixAt(i, dummy.matrix);
            particleMesh.setColorAt(i, p.color);
        }
        particleMesh.instanceMatrix.needsUpdate = true;
        if (particleMesh.instanceColor) { particleMesh.instanceColor.needsUpdate = true; }
    }

    /* ---- route constellation (the drill-down's 3D half) */

    let constellation = null;
    let constellationClock = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function errorColor(out, rate) {
        if (rate <= 0.15) { return out.setHex(COLOR.ok).lerp(new THREE.Color(COLOR.warn), rate / 0.15); }
        return out.setHex(COLOR.warn).lerp(new THREE.Color(COLOR.bad), clamp((rate - 0.15) / 0.35, 0, 1));
    }

    function buildConstellation(b) {
        const group = new THREE.Group();
        scene.add(group);
        return { backendId: b.id, group: group, sats: new Map(), grow: 0, closing: false };
    }

    function disposeConstellation() {
        if (!constellation) { return; }
        constellation.sats.forEach(disposeSatellite);
        scene.remove(constellation.group);
        constellation = null;
    }

    function disposeSatellite(sat) {
        if (sat.group.parent) { sat.group.parent.remove(sat.group); }
        sat.mat.dispose();
        sat.stalkMat.dispose();
        sat.labelDiv.remove();
    }

    function createSatellite(key) {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: COLOR.ok, roughness: 0.4, transparent: true });
        const mesh = new THREE.Mesh(satSphereGeo, mat);
        mesh.userData.satKey = key;
        group.add(mesh);
        const stalkMat = new THREE.MeshBasicMaterial({ color: 0x9fb0d0, transparent: true, opacity: 0.8 });
        group.add(new THREE.Mesh(satStalkGeo, stalkMat));
        const labelDiv = h("div", { class: "lbl route", text: key });
        const label = new CSS2DObject(labelDiv);
        group.add(label);
        return {
            key: key, group: group, mesh: mesh, mat: mat, stalk: group.children[1], stalkMat: stalkMat,
            label: label, labelDiv: labelDiv, target: new THREE.Vector3(), spawn: 0, pulse: 0, radius: 0.2, row: null
        };
    }

    const satSphereGeo = new THREE.SphereGeometry(1, 20, 14);
    const satStalkGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
    satStalkGeo.translate(0, 0.5, 0);

    /* The top routes by count each get a satellite; everything past that folds into one "(other)" satellite so the ring stays readable. */
    function wantedRoutes() {
        const rows = S.detail ? Array.from(S.detail.routes.values()) : [];
        rows.sort(function (a, b) { return b.count - a.count; });
        const named = rows.filter(function (r) { return r.key !== "(other)"; });
        const top = named.slice(0, MAX_SATELLITES);
        const rest = rows.filter(function (r) { return top.indexOf(r) === -1; });
        if (rest.length === 0) { return top; }

        let count = 0, errors = 0, p95 = 0, avgSum = 0;
        rest.forEach(function (r) { count += r.count; errors += r.errors; p95 = Math.max(p95, r.p95Ms); avgSum += r.avgMs * r.count; });
        return top.concat([{ key: "(other)", method: "", route: "(other)", count: count, errors: errors, p95Ms: p95, avgMs: count ? avgSum / count : 0 }]);
    }

    function refreshConstellation() {
        if (!constellation || constellation.closing) { return; }
        const wanted = wantedRoutes();
        const keys = new Set(wanted.map(function (r) { return r.key; }));

        constellation.sats.forEach(function (sat, key) {
            if (!keys.has(key)) { disposeSatellite(sat); constellation.sats.delete(key); }
        });

        wanted.forEach(function (row, i) {
            let sat = constellation.sats.get(row.key);
            if (!sat) {
                sat = createSatellite(row.key);
                constellation.group.add(sat.group);
                constellation.sats.set(row.key, sat);
                sat.group.position.set(0, 0.9, 0);
            }
            sat.row = row;
            const a = (Math.PI * 2 * i) / wanted.length;
            sat.target.set(Math.cos(a) * SATELLITE_RING_RADIUS, 0.9, Math.sin(a) * SATELLITE_RING_RADIUS);
        });
    }

    function updateConstellation(dt) {
        const c = constellation;
        if (!c) { return; }
        const b = S.backends.get(c.backendId);
        if (!b || !b.view) { disposeConstellation(); return; }

        constellationClock += dt;
        if (constellationClock > CONSTELLATION_REFRESH_S) { constellationClock = 0; refreshConstellation(); }

        c.grow = c.closing ? c.grow - dt / 0.4 : Math.min(1, c.grow + dt / 0.5);
        if (c.closing && c.grow <= 0) { disposeConstellation(); return; }

        c.group.position.copy(b.view.group.position);
        const color = new THREE.Color();

        c.sats.forEach(function (sat) {
            sat.group.position.lerp(sat.target, Math.min(1, dt * 6));
            sat.spawn = Math.min(1, sat.spawn + dt / 0.5);
            sat.pulse = Math.max(0, sat.pulse - dt * 3);

            const row = sat.row;
            const hovered = S.hoverRoute === sat.key;
            sat.radius = 0.16 + 0.11 * Math.log10(1 + row.count);
            const s = easeOutBack(sat.spawn) * clamp(c.grow, 0, 1) * (1 + sat.pulse * 0.5 + (hovered ? 0.35 : 0));

            sat.mesh.scale.setScalar(Math.max(0.001, sat.radius * s));
            sat.mat.color.copy(errorColor(color, row.count ? row.errors / row.count : 0));
            sat.mat.emissive.setHex(0xffffff);
            sat.mat.emissiveIntensity = hovered ? 0.5 : sat.pulse * 0.4;
            sat.mat.opacity = 0.95;

            const stalkLength = 0.15 + 0.5 * Math.log10(1 + (row.p95Ms || 0));
            sat.stalk.scale.set(1, Math.max(0.001, (sat.radius + stalkLength) * s), 1);
            sat.label.position.set(0, (sat.radius + stalkLength + 0.35) * s, 0);
            sat.labelDiv.textContent = (row.method ? row.method + " " : "") + (row.guessed ? "~ " : "") + row.route;
            sat.labelDiv.style.opacity = String(clamp(c.grow, 0, 1));
        });
    }

    function satelliteFor(b, key) {
        if (!constellation || constellation.closing || constellation.backendId !== b.id) { return null; }
        return constellation.sats.get(key) || constellation.sats.get("(other)") || null;
    }

    const satWorldTmp = new THREE.Vector3();
    function satelliteWorld(sat) {
        return satWorldTmp.copy(constellation ? constellation.group.position : HUB).add(sat.group.position);
    }

    /* ---- camera focus */

    let tween = null;
    const overviewTarget = new THREE.Vector3(0, 1, 0);
    const goalTarget = new THREE.Vector3();
    const goalPosition = new THREE.Vector3();
    camera.position.set(0, 13, 17);
    controls.target.copy(overviewTarget);

    function computeGoal() {
        const b = S.focusId !== null ? S.backends.get(S.focusId) : null;
        if (b && b.view) {
            const p = b.view.group.position;
            goalTarget.set(p.x, b.view.height * 0.5 + 0.6, p.z);
            const out = new THREE.Vector3(p.x, 0, p.z);
            if (out.lengthSq() < 0.01) { out.set(0, 0, 1); }
            out.normalize().multiplyScalar(FOCUS_DISTANCE);
            goalPosition.set(p.x + out.x, goalTarget.y + FOCUS_HEIGHT, p.z + out.z);
        } else {
            goalTarget.copy(overviewTarget);
            goalPosition.set(0, ringRadius * 0.85 + 6, ringRadius * 1.35 + 6);
        }
    }

    function startTween() {
        tween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
    }

    /*
     * While a backend is focused the drill-down panel covers the right of
     * the screen, so the projection is shifted left by half its width -
     * the focused node then sits in the middle of the space that is left,
     * not behind the panel.
     */
    let viewShift = 0;
    function updateViewShift(dt) {
        const drill = $("drill");
        const wanted = S.focusId !== null && window.innerWidth > 820 ? (drill.getBoundingClientRect().width + 12) / 2 : 0;
        viewShift += (wanted - viewShift) * Math.min(1, dt * 6);
        const w = Math.max(1, container.clientWidth), hgt = Math.max(1, container.clientHeight);
        if (Math.abs(viewShift) > 0.5) { camera.setViewOffset(w, hgt, viewShift, 0, w, hgt); }
        else if (camera.view && camera.view.enabled) { camera.clearViewOffset(); }
    }

    function updateCamera(dt) {
        updateViewShift(dt);
        computeGoal();
        if (tween) {
            tween.t += dt / CAMERA_TWEEN_S;
            const e = easeInOutCubic(Math.min(tween.t, 1));
            camera.position.lerpVectors(tween.fromPos, goalPosition, e);
            controls.target.lerpVectors(tween.fromTarget, goalTarget, e);
            if (tween.t >= 1) { tween = null; }
        } else if (S.focusId !== null && S.backends.has(S.focusId) && S.backends.get(S.focusId).view) {
            /* Follow the node as the ring re-spaces, keeping whatever orbit angle the viewer chose. */
            const dx = goalTarget.x - controls.target.x, dz = goalTarget.z - controls.target.z;
            camera.position.x += dx; camera.position.z += dz;
            controls.target.x += dx; controls.target.z += dz;
        }
        controls.update();
    }

    /* ---- picking */

    function toPointer(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
    }

    function pickBackend(event) {
        toPointer(event);
        const bodies = [];
        S.backends.forEach(function (b) { if (b.view && !b.view.removing) { bodies.push(b.view.body); } });
        const hits = raycaster.intersectObjects(bodies, false);
        return hits.length ? hits[0].object.userData.backendId : null;
    }

    function pickSatellite(event) {
        if (!constellation) { return null; }
        toPointer(event);
        const meshes = [];
        constellation.sats.forEach(function (sat) { meshes.push(sat.mesh); });
        const hits = raycaster.intersectObjects(meshes, false);
        return hits.length ? hits[0].object.userData.satKey : null;
    }

    let pressed = null;
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", function (e) { pressed = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener("pointerup", function (e) {
        if (!pressed) { return; }
        const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5;
        pressed = null;
        if (moved) { return; }
        const id = pickBackend(e);
        if (id) { focusBackend(id); } else if (S.focusId !== null) { unfocus(); }
    });
    canvas.addEventListener("pointermove", function (e) {
        if (pressed) { return; }
        if (S.focusId !== null) {
            const key = pickSatellite(e);
            setHoverRoute(key, false);
            canvas.style.cursor = key || pickBackend(e) ? "pointer" : "";
        } else {
            canvas.style.cursor = pickBackend(e) ? "pointer" : "";
        }
    });
    canvas.addEventListener("pointerleave", function () { if (S.hoverRoute !== null) { setHoverRoute(null, false); } });

    /* ---- sizing */

    function resize() {
        const w = Math.max(1, container.clientWidth), hgt = Math.max(1, container.clientHeight);
        renderer.setSize(w, hgt);
        labels.setSize(w, hgt);
        camera.aspect = w / hgt;
        camera.updateProjectionMatrix();
    }
    resize();
    new ResizeObserver(resize).observe(container);

    /* ---- the object the overlay drives */

    return {
        backendAppeared: function (b, animate) {
            if (b.view) { disposeView(b); }
            b.view = createView(b, animate);
            if (animate) { flashNode(b, COLOR.ok, 1); }
        },
        backendRemoved: function (b) {
            if (b.view && !b.view.removing) { b.view.removing = { reason: b.removed.reason, t: 0, age: 0 }; }
        },
        dropBackend: function (b) {
            if (constellation && constellation.backendId === b.id) { disposeConstellation(); }
            disposeView(b);
        },
        leaseRenewed: function (b) { flashNode(b, COLOR.lease, 0.45); },
        spawn: function (b, requestId) {
            hubPulse = 1;
            if (!b.view) { return; }
            if (REDUCED_MOTION) { flashNode(b, COLOR.info, 0.6); return; }
            /* While drilled into one backend, thin the traffic to the others so attention stays on it. */
            if (S.focusId !== null && S.focusId !== b.id && Math.random() < 0.7) { return; }
            const i = freeList.pop();
            if (i === undefined) { return; }
            const p = particles[i];
            p.active = true; p.dirty = true; p.phase = PHASE_FLY; p.t = 0; p.b = b; p.reqId = requestId;
            p.result = null; p.key = null; p.sat = null; p.orbit = Math.random() * Math.PI * 2;
            p.pos.copy(HUB);
            p.color.setHex(COLOR.dispatch);
            particleOf.set(requestId, i);
        },
        settle: function (b, call, animate) {
            const color = call.outcome === "completed" ? statusColor(call.status) : call.outcome === "failed" ? COLOR.bad : COLOR.warn;
            if (animate) { flashNode(b, color, 0.5); }
            const i = particleOf.get(call.requestId);
            if (i === undefined) { return; }
            particleOf.delete(call.requestId);
            const p = particles[i];
            if (!p.active || p.reqId !== call.requestId) { return; }
            p.result = color;
            p.key = call.method + " " + call.route;
            if (p.phase === PHASE_ORBIT) { resolveParticle(p); }
        },
        unroutable: function () { hubPulse = 1; hubAlarm = 1; },
        resync: function () {
            particleOf.clear();
            for (let i = 0; i < POOL_SIZE; i++) {
                const p = particles[i];
                if (p.active && p.result === null) {
                    p.result = COLOR.info;
                    if (p.phase === PHASE_ORBIT) { resolveParticle(p); }
                }
            }
        },
        focus: function (b) {
            disposeConstellation();
            constellation = buildConstellation(b);
            constellationClock = CONSTELLATION_REFRESH_S;
            controls.autoRotate = false;
            startTween();
        },
        unfocus: function () {
            if (constellation) { constellation.closing = true; }
            startTween();
        },
        routesChanged: function () { /* the constellation refreshes itself on a short timer */ },
        hoverChanged: function () { /* satellites read S.hoverRoute every frame */ },
        frame: function (dt) {
            layoutRing(dt);
            S.backends.forEach(function (b) { if (b.view) { updateView(b, dt); } });
            updateParticles(dt);
            updateConstellation(dt);
            updateCamera(dt);

            hubPulse = Math.max(0, hubPulse - dt * 4);
            hubAlarm = Math.max(0, hubAlarm - dt * 1.5);
            hub.scale.setScalar(1 + hubPulse * 0.22);
            hub.rotation.y += dt * 0.3;
            hubMat.emissive.setHex(0x3b5bdb).lerp(RED, hubAlarm);
            hubMat.opacity = 1;
            const hubDim = S.focusId !== null ? 0.35 : 1;
            hubMat.transparent = hubDim < 1;
            hubMat.opacity = hubDim;
            hubLabelDiv.style.opacity = String(hubDim);
            setText(hubLabelDiv, S.strategy);
            ringGuide.scale.setScalar(ringRadius);

            renderer.render(scene, camera);
            labels.render(scene, camera);
        }
    };
}

connect();
renderAll();
setInterval(renderAll, OVERLAY_INTERVAL_MS);

let lastFrame = performance.now();
function loop(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    drainQueue();
    if (scene3d) { scene3d.frame(dt); }
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

createScene().then(function (api) {
    scene3d = api;
    if (!api) { return; }
    /* Backends that arrived before the scene was ready get their nodes now. */
    S.backends.forEach(function (b) {
        api.backendAppeared(b, false);
        if (b.removed) { api.backendRemoved(b); }
    });
    handleHash();

    /* A #backend= link focuses before the scene exists; the overlay half is done, the 3D half catches up here. */
    const focused = S.focusId === null ? undefined : S.backends.get(S.focusId);
    if (focused) { api.focus(focused); }
});
`;
