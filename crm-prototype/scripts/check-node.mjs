// Понятная ошибка вместо падения, если Node.js слишком старый для встроенного node:sqlite.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`\nНужен Node.js 22.13 или новее, сейчас ${process.versions.node}.\nУстановите LTS-версию с https://nodejs.org и повторите: npm ci && npm run build && npm start\n`);
  process.exit(1);
}
