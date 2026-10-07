// Точка входа веб-демо: включает режим, подменяет API браузерной реализацией и запускает тот же интерфейс.
(globalThis as { __ONAIR_WEB_DEMO__?: boolean }).__ONAIR_WEB_DEMO__ = true;
import { installFakeApi } from './fakeApi';
installFakeApi();
void import("../client/main");
