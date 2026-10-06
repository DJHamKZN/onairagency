import { createApp, createState } from './app';
import { loadEnv } from './env';
import { ensureUsers, resolveDemoPassword, seedDemo } from './seed';

loadEnv();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5174);
const dbPath = process.env.DB_PATH || './data/crm.sqlite';

if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.error(`Отказ запуска: HOST=${host}. Прототип запускается только на локальном интерфейсе (127.0.0.1).`);
  process.exit(1);
}

const state = createState(dbPath);
const { password, generated } = resolveDemoPassword();
if (state.repo.users().length === 0 || process.env.DEMO_USER_PASSWORD) ensureUsers(state.repo, password);
if (state.repo.opportunities().length === 0 && state.repo.companies().length === 0) {
  seedDemo(state.repo);
  console.log('База пуста — загружены синтетические демо-данные.');
}
if (generated && state.repo.users().length > 0)
  console.log(`DEMO_USER_PASSWORD не задан. Сгенерирован пароль для тестовых учётных записей: ${password}\n(Задайте его в .env, чтобы он не менялся.)`);

createApp(state).listen(port, host, () => {
  console.log(`ON AIR CRM — локальный прототип: http://${host}:${port}`);
  console.log('Учётные записи (синтетические): owner, pm, pm2, lead, spec, rpm. Не используйте реальные данные клиентов.');
});
