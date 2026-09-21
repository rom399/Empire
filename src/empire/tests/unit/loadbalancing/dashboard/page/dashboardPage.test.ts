import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { renderDashboardPage } from "../../../../../src/loadbalancing/dashboard/page/dashboardPage";

const THREE_BASE = "https://cdn.jsdelivr.net/npm/three@0.170.0/";

/**
 * The dashboard's client script cannot run under Vitest, so these tests
 * guard the mistakes that would otherwise only show up in a browser: a
 * syntax error, a template placeholder left unreplaced, an element id the
 * script uses that the markup does not define, or a value that could break
 * out of its script element.
 */
describe("renderDashboardPage", () => {

    function render(basePath = "/_lb", threeBaseUrl = THREE_BASE): string {
        return renderDashboardPage({ basePath, threeBaseUrl });
    }

    function moduleScript(html: string): string {
        const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);

        if (!match) {
            throw new Error("no module script found");
        }

        return match[1];
    }

    it("is a complete HTML document", () => {
        const html = render();

        expect(html.startsWith("<!doctype html>")).toBe(true);
        expect(html).toContain("<title>Empire load balancer</title>");
        expect(html.trimEnd().endsWith("</html>")).toBe(true);
    });

    it("declares an import map that resolves three and three/addons/ against the base URL", () => {
        const html = render();
        const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);

        expect(map).not.toBeNull();
        expect(JSON.parse(map?.[1] ?? "{}")).toEqual({
            imports: {
                three: `${THREE_BASE}build/three.module.js`,
                "three/addons/": `${THREE_BASE}examples/jsm/`,
            },
        });
    });

    it("places the import map before the module script that depends on it", () => {
        const html = render();

        expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
    });

    it("injects the base path and three base URL into the script as string literals", () => {
        const script = moduleScript(render("/dash", "https://mirror.example/three/"));

        expect(script).toContain('const BASE = "/dash";');
        expect(script).toContain('const THREE_BASE = "https://mirror.example/three/";');
    });

    it("leaves no template placeholder unreplaced", () => {
        expect(render()).not.toMatch(/__[A-Z_]+__/);
    });

    it("cannot be broken out of by a hostile base path or URL", () => {
        const hostile = '/x"</script><script>alert(1)</script>';
        const html = render(hostile, `https://evil.example/</script><script>alert(2)</script>/`);

        expect(html.match(/<script/g)).toHaveLength(2); // the import map and the module script - nothing injected
        expect(html.match(/<\/script>/g)).toHaveLength(2);
        expect(html).not.toContain("alert(1)</script>");
    });

    it("contains a client script that parses as a valid ES module", () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "empire-lb-page-")), "client.mjs");
        fs.writeFileSync(file, moduleScript(render()));

        try {
            expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
        } finally {
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
        }
    });

    it("defines every element id the client script looks up", () => {
        const html = render();
        const script = moduleScript(html);
        const looked = new Set(Array.from(script.matchAll(/\$\("([A-Za-z]+)"\)/g), (match) => match[1]));
        const defined = new Set(Array.from(html.matchAll(/\bid="([A-Za-z]+)"/g), (match) => match[1]));

        expect(looked.size).toBeGreaterThan(10);

        const missing = Array.from(looked).filter((id) => !defined.has(id));
        expect(missing).toEqual([]);
    });

    it("only ever writes server-supplied text through textContent, never innerHTML", () => {
        const script = moduleScript(render());

        expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    });

    it("degrades to overlay-only when three.js or WebGL is unavailable", () => {
        const script = moduleScript(render());

        expect(script).toContain("3D view unavailable");
        expect(script).toContain("WebGL is not available");
    });

    it("honours prefers-reduced-motion and the colour scheme", () => {
        const html = render();

        expect(html).toContain("prefers-reduced-motion");
        expect(html).toContain("prefers-color-scheme: dark");
    });

    it("caps the device pixel ratio at 2", () => {
        expect(moduleScript(render())).toContain("Math.min(window.devicePixelRatio || 1, 2)");
    });
});
