/** Режим веб-демо (всё в браузере, без сервера). Устанавливается точкой входа src/browser/main.tsx. */
export const isWebDemo = () => !!(globalThis as { __ONAIR_WEB_DEMO__?: boolean }).__ONAIR_WEB_DEMO__;
