import type { NextConfig } from "next";

// `pnpm build:demo` sets NEXT_PUBLIC_DEMO=1 and builds plain static files for GitHub Pages,
// served under /<repo>/ (NEXT_PUBLIC_BASE_PATH). The normal build is the standalone server.
const demo = process.env.NEXT_PUBLIC_DEMO === "1";

const config: NextConfig = {
  transpilePackages: ["@smart-cart/contracts", "@smart-cart/demo"],
  ...(demo
    ? { output: "export", basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined, trailingSlash: true }
    : { output: "standalone" }),
};

export default config;
