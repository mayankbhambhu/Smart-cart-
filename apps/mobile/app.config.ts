import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json plus build-time settings. EXPO_BASE_URL serves the web demo from a sub-path, e.g.
 * /Smart-cart-/app on GitHub Pages; phone builds ignore it.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
