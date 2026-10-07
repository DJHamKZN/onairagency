/** Режим веб-демо (всё в браузере, без сервера). Устанавливается точкой входа src/browser/main.tsx. */
export const isWebDemo = () => !!(globalThis as { __ONAIR_WEB_DEMO__?: boolean }).__ONAIR_WEB_DEMO__;

/** Сообщение веб-демо о загрузке сохранённых данных (миграция или непрочитанные данные). */
export const demoNotice = () => (globalThis as { __ONAIR_DEMO_NOTICE__?: string }).__ONAIR_DEMO_NOTICE__ ?? null;
