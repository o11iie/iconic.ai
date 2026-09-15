/**
 * Metro inlines `process.env.EXPO_PUBLIC_*` at build time, so these are
 * available in the bundle without Node's runtime. Declared narrowly here
 * rather than pulling in all of @types/node, which would wrongly suggest
 * Node APIs (fs, path, Buffer) are usable in the React Native runtime.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_WEB_BASE_URL?: string;
    EXPO_PUBLIC_SUPPORT_EMAIL?: string;
    NODE_ENV?: string;
  };
};
