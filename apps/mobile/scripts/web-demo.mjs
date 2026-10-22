// Builds the shopper app as a clickable web demo (EXPO_PUBLIC_DEMO=1: a simulated store, no server)
// into dist-web/, so it runs from any folder: GitHub Pages (/Smart-cart-/app/) or a preview page.
//
// Expo bakes the base path in at build time. We build with a placeholder and swap it for a value
// the page works out from its own address when it loads.
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER = "/__SCBASE__";
const out = "dist-web";
rmSync(out, { recursive: true, force: true });
execSync(`expo export --platform web --output-dir ${out}`, {
  stdio: "inherit",
  env: { ...process.env, EXPO_PUBLIC_DEMO: "1", EXPO_BASE_URL: PLACEHOLDER },
});

const jsDir = join(out, "_expo/static/js/web");
for (const file of readdirSync(jsDir)) {
  const path = join(jsDir, file);
  const js = readFileSync(path, "utf8");
  // Every occurrence sits inside a double-quoted string literal, so splice the runtime value in.
  if (/[`']\/__SCBASE__/.test(js)) throw new Error(`${file}: base path placeholder outside a "string"`);
  writeFileSync(path, js.replaceAll(PLACEHOLDER, '"+window.__SC_BASE__+"'));
}

// One copy of the page per screen, so reloading or sharing e.g. /app/cart/ works on a static host.
// Each copy knows how deep it sits, so it can work out the app's folder from its own address.
const template = readFileSync(join(out, "index.html"), "utf8");
const screens = [
  "", "sign-in", "change-password", "pair", "find", "list", "ask", "help", "cart", "cart/scan", "cart/checkout",
  "browse", "reserve", "staff", "staff/help", "staff/picklist", "staff/tasks", "staff/stock", "staff/exit",
];
for (const screen of screens) {
  const depth = screen ? screen.split("/").length : 0;
  const html = template.replaceAll(`${PLACEHOLDER}/`, "../".repeat(depth) || "./").replace(
    "</head>",
    `<script>
      // The folder the app is served from, e.g. /Smart-cart-/app. Its screens live under it.
      window.__SC_BASE__ = location.pathname.replace(/\\/(index\\.html)?$/, "").split("/").slice(0, ${-depth} || undefined).join("/");
      if (location.pathname.endsWith("/index.html")) history.replaceState(null, "", location.pathname.slice(0, -10) + location.search);
    </script>
    <style>html,body{background:#F8FAFC}</style>
  </head>`,
  );
  mkdirSync(join(out, screen), { recursive: true });
  writeFileSync(join(out, screen, "index.html"), html);
}
console.log(`Web demo ready in ${out}/`);
