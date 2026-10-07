# Модель данных

Источник истины — `src/domain/types.ts`. Хранение — SQLite (`server/db.ts`).

## Принципы

- **Устойчивые ID** с префиксом типа (`opp_…`, `src_…`, `fnd_…`). Находки дополнительно имеют стабильный код `F-001`, который не меняется при переименовании.
- **Общие поля записи** (`BaseRecord`): `id, createdAt, createdBy, updatedAt, updatedBy, rev, isDemo`.
- **Отсутствие значения — `null`**, а не `0` и не `""`. Ноль в расчёте допустим только с `zeroReason`.
- **Деньги — целые копейки** (`Kop`), доли — базисные пункты (`Bp`, 10000 = 100 %). Округление half-up; цена по формуле — вверх до рубля (настраивается).
- **Клиент не копируется в документы**: КП и экспорты ссылаются на `Company` и строятся на лету.
- **Неизменяемые снимки**: утверждение и фиксация отправки сохраняют снимок в append-only таблицу `snapshots`.

## Сущности и связи

```
Company 1─* Contact
Company 1─* Opportunity ─* related (paid_diagnostic ↔ implementation) ─ Opportunity
Opportunity (агрегат, версия rev — optimistic concurrency)
 ├─ Source*            текст + метаданные оригинала (original.stored = false всегда); версии previousVersionId
 ├─ ProposedChange*    → Source; результат демо-разбора; pending/accepted/rejected/conflict
 ├─ Fact*              → Source; key, value, status, excerpt, timecode, history[], needsRecheck
 ├─ Conflict*          → Fact, ProposedChange; два значения и два источника; resolution(by, role, comment)
 ├─ AgencyPromise*     → Source?; discussed/confirmed/withdrawn; conditional
 ├─ Clarification*     вопрос, адресат-роль, влияние (маршрут/состав/стоимость/сроки/риск/приёмка)
 ├─ Task*              блокеры, ожидание оценки/решения
 ├─ AuditRoute         тип A/B/C, глубина, полный аудит (явно), лимит пресейла, модули, путь заявки, deliverables
 ├─ AuditFinding*      → Source?; claimType отдельно от verification; evidenceReview; numbers[]
 ├─ WorkItem*          basis → AuditFinding | задача клиента; объём, приёмка, разовая/регулярная
 ├─ EstimateVersion*   lines[CostLine], комиссия, маржа, налоговая модель, режим цены, скидка, внешние бюджеты; draft|locked
 ├─ CommissionRule*    ставка, база (agency_fee | other + сумма), период, условие, получатель-роль, ownerApproved
 ├─ ProposalVersion*   → EstimateVersion (1:1), previousVersionId; содержание; sent/accepted/rejected события
 ├─ Approval*          → ProposalVersion, EstimateVersion, Snapshot; active|revoked(reason, categories)
 ├─ LaunchChecklist    18 пунктов (done | not_applicable + причина), фактический статус оплаты, linkSharedAt
 ├─ HandoffAcceptance* packageHash, accepted|returned, remarks, by (принимающий PM)
 └─ LaunchAuthorization* packageHash, proposalVersionId, by (владелец)
ChangeEvent*  (отдельная append-only таблица) before/after/reason/userId/actingRole/override
Snapshot*     (отдельная append-only таблица) kind approval | proposal_sent, hash, data
User          роли; пароль — только scrypt-хэш на сервере
```

## Обязательные поля и ограничения (проверяются в `commands.ts`)

| Сущность / действие | Обязательно | Ограничения |
|---|---|---|
| Новый запрос | компания или название, исходный запрос, обещания либо «не зафиксированы», ответственный, следующий шаг (что, кто, срок) | бюджет, бриф и аудит не требуются |
| Fact (однозначные поля) | значение, статус | другое значение из нового источника → `Conflict`, без перезаписи; правка подтверждённого → статус «требует уточнения» + причина |
| Многозначные (метрики, упоминания бюджета) | — | добавляются рядом, не суммируются; упоминание бюджета всегда «требует уточнения» |
| Source | название, текст или ссылка | ≤ 80 000 символов; похожие на секреты строки отклоняются; чужая компания или более старая дата при замене → карантин |
| AuditModule | статус; причина для частично/неприменимо/нужен доступ | «нужен доступ» → какой доступ, у кого, какое решение заблокировано |
| AuditFinding → «подтверждено» | источник (актуальный), цитата (не URL), для чисел — сущность/единица/период/способ (+знаменатель для %), явное решение проверяющего | по внешним данным нельзя утверждать CAC, маржу, качество лидов, конверсию продаж |
| WorkItem в КП | основание, ожидаемый результат, количество+единица, критерий приёмки | основание-находка должна быть подтверждена |
| CostLine | часы и ставка (часовые) или сумма | `null` → расчёт неполный; `0` только с причиной; отрицательные — ошибка; ставки меняет только владелец |
| Approval | полный расчёт, все работы валидны, обязательные разделы КП, нет открытых противоречий, правило комиссии утверждено | снимается при изменении: объём, цена, скидка, комиссия/база, оплата, сроки, бесплатные работы, зависимости, затраты, маржа, текст КП |
| Отправка КП | статус «утверждён для отправки», действующее утверждение, номер версии, получатель, дата | после — версия и расчёт неизменяемы |
| Принятие КП | отправленная, не заменённая, последняя версия; номер, дата, источник подтверждения | |
| Пункт пакета | done → комментарий; not_applicable → причина | секреты отклоняются |
| Передано в работу | все пункты, статус оплаты, обещания разобраны, принятая последняя версия с действующим утверждением, приёмка PM и разрешение владельца на текущий хэш пакета | обход запрещён |

## Схема БД (миграция 1, `server/db.ts`)

| Таблица | Назначение |
|---|---|
| `schema_migrations` | применённые миграции |
| `users` | id, login, display_name, roles(JSON), password_hash (scrypt), is_demo |
| `sessions` | token_hash (SHA-256 токена), user_id, acting_role, expires_at |
| `companies`, `contacts` | данные JSON + version + is_demo |
| `opportunities` | агрегат JSON, stage, **version** (UPDATE … WHERE version = ?), is_demo |
| `change_events` | журнал; триггеры: UPDATE запрещён всегда, DELETE запрещён для is_demo = 0 |
| `snapshots` | снимки утверждений и отправок; те же триггеры |
| `settings` | одна строка, version |

**Компромисс прототипа:** вложенные сущности возможности хранятся в JSON агрегата. Ссылочная целостность внутри агрегата проверяется доменной логикой и валидатором резервной копии, а не внешними ключами SQL. Для промышленной версии стоит разнести ключевые сущности (КП, утверждения, находки) по отдельным таблицам с FK. Optimistic concurrency сейчас на уровне всей возможности: параллельная правка разных разделов одной карточки тоже даёт конфликт (без потери данных).

## Изменения 07.10.2026

- `CostLine.confidence` — происхождение оценки (`preliminary`, `specialist_estimate`); `confirmed` ставит только команда
  `verifyCostLine` (с `verifiedBy`, `verifiedAt`); изменение значения снимает проверку. `CostLine.recurrence` — часть
  (разовые/ежемесячные) для строк без привязки к работе; привязанные строки наследуют периодичность работы.
- `EstimateVersion.manualMonthlyPriceKop`, `discount.appliesTo`, `frozenRule` (копия правила комиссии на момент утверждения).
- `CommissionRule.appliesTo` — разовые, ежемесячные или обе части. Термины: P — цена услуг (выручка агентства); комиссия за
  привлечение — выплата из выручки; рекламный бюджет и внешние расходы клиента — `externalBudgets`, вне P, C и базы комиссии.
- Утверждение замораживает версию: `ProposalVersion.frozenWorks`, расчёт `status = locked`. `Approval.status = superseded`
  — версия заменена новой, решение сохранено. Различия новой версии с последней утверждённой — `diffMaterial`.
- `LaunchChecklist.items` — только проверки готовности (`open | ready | deviation | deviation_accepted | not_applicable`),
  `deviationDecision` — решение владельца. Договорённости не хранятся в чек-листе: `agreedTerms()` строит их из принятой версии.
- `ProposedChange.origin` (`keyword_rules` | `structured_import`), `fingerprint` (защита от дублей), `quoteFound`.
- `Clarification.factKey` — к какому полю относится вопрос (для «недостающих вопросов» без дублей).
- `AuditDeliverable.snapshotId`, `setNumber`; новые виды снимков `audit_brief`, `audit_client`, `audit_internal`.

## Версии схемы данных и миграция

| Версия | С какого числа | Что изменилось |
|---|---|---|
| 1 | 06.10.2026 | исходная схема |
| 2 | 07.10.2026 | чек-лист запуска — 13 проверок готовности (`open / ready / deviation / deviation_accepted / not_applicable`); `launch.legacyItems` — отметки прежней версии |

Миграция 1 → 2 (`src/domain/migrate.ts`) выполняется автоматически: при загрузке данных веб-демо из localStorage, при проверке
резервной копии (браузер, сервер, `restore-check`) и при запуске сервера на базе прежней версии (`server/migrateStore.ts`).
Правила: пункты, сохранившиеся в схеме, оставляют отметку, комментарий, автора и дату (`done` → `ready`); упразднённые
пункты (`goal_first_result`, `accepted_scope`, `scope_exclusions`, `revisions` — теперь из принятой версии КП;
`payment_status` — отдельное поле оплаты; `promises` — обещания во «Вводных») переносятся в `legacyItems` с указанием, где
их смысл теперь; недостающие пункты добавляются как `open`; неизвестный статус → `open` с исходным значением в комментарии.
Остальные поля карточки не меняются. В журнал добавляется событие `schema_migrated` (пользователь `system`). Повторный запуск
ничего не меняет. Резервные копии экспортируются со `schemaVersion: 2`.
