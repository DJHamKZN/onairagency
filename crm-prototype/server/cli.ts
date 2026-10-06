import { readFileSync, rmSync } from 'node:fs';
import { validateBackupText } from '../src/domain/backup';
import { openDb } from './db';
import { loadEnv } from './env';
import { Repo } from './repo';
import { ensureUsers, resolveDemoPassword, seedDemo } from './seed';

loadEnv();
const [cmd, arg] = process.argv.slice(2);
const dbPath = process.env.DB_PATH || './data/crm.sqlite';

if (cmd === 'seed') {
  const repo = new Repo(openDb(dbPath));
  const { password, generated } = resolveDemoPassword();
  ensureUsers(repo, password);
  if (repo.opportunities().length) {
    console.log('В базе уже есть данные. Для повторного наполнения используйте «Очистить демо-данные» в интерфейсе (владелец).');
  } else {
    seedDemo(repo);
    console.log('Синтетические демо-данные загружены.');
  }
  if (generated) console.log(`Пароль тестовых учётных записей: ${password}`);
} else if (cmd === 'restore-check') {
  // Восстановление копии в ОТДЕЛЬНУЮ чистую базу и сверка. Исходная база не открывается и не меняется.
  if (!arg) { console.error('Использование: npm run restore-check -- <файл-копии.json>'); process.exit(2); }
  const preview = validateBackupText(readFileSync(arg, 'utf8'));
  if (!preview.ok || !preview.backup) { console.error('Копия не прошла проверку:\n- ' + preview.errors.join('\n- ')); process.exit(1); }
  const target = `./data/restore-check-${Date.now()}.sqlite`;
  const repo = new Repo(openDb(target));
  repo.importInto(preview.backup);
  const b = preview.backup;
  const again = repo.exportBackup();
  const checks: [string, boolean][] = [
    ['Возможности', again.opportunities.length === b.opportunities.length],
    ['Компании', again.companies.length === b.companies.length],
    ['События журнала', again.changeEvents.length === b.changeEvents.length],
    ['Снимки', again.snapshots.length === b.snapshots.length],
    ['Версии КП', again.opportunities.every((o) => o.proposals.length === b.opportunities.find((x) => x.id === o.id)!.proposals.length)],
    ['Версии записей', again.opportunities.every((o) => o.rev === b.opportunities.find((x) => x.id === o.id)!.rev)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  repo.db.close();
  if (process.argv.includes('--keep')) console.log(`Проверочная база сохранена: ${target}`);
  else { rmSync(target, { force: true }); rmSync(`${target}-wal`, { force: true }); rmSync(`${target}-shm`, { force: true }); }
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
} else {
  console.log('Команды: seed | restore-check <file.json> [--keep]');
}
