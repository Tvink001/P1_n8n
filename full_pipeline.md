# Проект 1 — Полный пайплайн разработки

Этот документ — операторский. Он отвечает на четыре вопроса: что строить, в каком порядке, с каким временным бюджетом, против каких quality gates. Прочитай целиком один раз перед стартом — окупится многократно.

Документ не дублирует технические детали. Они живут в двух других файлах:
- `CLAUDE.md` — свод правил, который Claude Code читает на каждом промпте
- `project_specs.md` — техническая спецификация: архитектура, узлы воркфлоу, интеграционные правила, конфигурация Cloud, quality gates. И ты, и Claude Code пишете в него по ходу разработки.

`prompts.md` содержит атомарную последовательность промптов. `learnings.md` ты ведёшь сам — туда записываются gotchas и переиспользуемые паттерны.

---

## Что ты строишь

Production-ready пайплайн обработки лидов на **n8n Cloud**. Лид заходит через Google Form → валидируется → дедуплицируется → квалифицируется через Claude Haiku → маршрутизируется в нужный менеджерский чат по бюджету → доставляется в Telegram с тремя inline-кнопками. Нажатие кнопок обновляет Sheet и редактирует то же сообщение in-place. Лиды старше 30 минут получают один reminder.

Это **portfolio case study**, а не shippable template. Твой Cloud-инстанс остаётся приватным — ревьюер видит результат через скриншоты, GIF demo и workflow JSON в репозитории. Setup-guide для самостоятельного разворачивания не нужен.

Полный технический брейкдаун — в `project_specs.md` разделы 6–17.

---

## Стек одним взглядом

n8n Cloud (Pro план) — Google Forms линкнутая в Sheet — Telegram Bot API — Anthropic Claude Haiku 4.5 — Gmail SMTP для error alerts.

Реалистичные SLA: n8n Cloud декларирует 99.9% uptime, p95 latency end-to-end <5 секунд, стоимость инфраструктуры ~$50/мес (n8n Cloud Pro). Это те числа, что идут в README.

Полная таблица технологий с обоснованиями — `project_specs.md` раздел 2.

---

## Почему n8n Cloud, а не self-hosted

Я архитектурно выбираю Cloud для этого проекта. Решение задокументировано в `project_specs.md` раздел 2.1. Краткая логика:

Это portfolio case, не shippable template. Ревьюер не разворачивает у себя. Cloud's «zero ops overhead» здесь — полностью plus, без обратной стороны.

n8n Cloud полностью поддерживает публичный API. Это проверено через официальную доку n8n (май 2026): API включён по умолчанию на каждом Cloud-инстансе, идентичная аутентификация через `X-N8N-API-KEY`, те же endpoints `/api/v1/*`. Это значит — n8n-MCP работает с Cloud точно так же, как с self-hosted. Никакой функциональной потери.

Infrastructure-уровень концерны (encryption key, persistent volume, БД движок, автоматические бэкапы, OS patching, TLS) — забота Cloud, не моя. Моя ответственность сжимается до workflow design, credential hygiene, idempotency, error trigger linkage, AI graceful fallback. Эти оставшиеся концерны — high-signal для портфолио-ревьюера.

Стоимость соответствует use case. Pro план ~$50/мес покрывает с большим запасом. Self-hosting на Railway free tier сэкономил бы $50/мес, но добавил бы 10–15 часов ops-работы плюс single-point-of-failure (потеря encryption key = потеря credentials).

Для будущего production deployment'а клиенту, которому критична data residency — self-hosting валиден, и архитектура переносится. Workflow JSON портабельны между Cloud и self-hosted.

---

## Инструменты — что обязательно, что твоё

**Обязательно (Claude Code использует напрямую):**
- **n8n-MCP** — все воркфлоу создаются, валидируются, тестируются через этот MCP против твоего Cloud-инстанса. Никаких диктовок кликов, никакого ручного импорта JSON.
- **Context7 MCP** — свежие доки по любым библиотекам и API, когда n8n-MCP indexer что-то не покрывает.

**Твои инструменты (Claude Code про них не знает):**
- **Compound engineering plugin** — методология, которую ты используешь между промптами для планирования, ревью и фиксации уроков. Это твой operator-side layer. В промптах Claude Code про него ничего не сказано — он работает только с MCP-инструментами.
- **`learnings.md`** — ты ведёшь его сам, накапливая теги типа `#n8n`, `#telegram`, `#sheets`, `#claude-api`, `#debugging`. Claude Code на старте каждого промпта читает этот файл через Rule 1 — но писать туда не его задача. Он может предложить, что записать; ты решаешь.

Это разделение критично. Claude Code = инструмент сборки. Ты = архитектор + ревьюер + хранитель знаний.

---

## Таймлайн — реалистичные оценки

Полная сборка занимает ~22 часа фокусной работы (Cloud-вариант на ~4 часа короче self-hosted'а за счёт отсутствия Railway setup, Postgres provisioning, env vars block, restore drill). При 8 часах/день с rest day по четвергу — три-четыре рабочих дня.

| Стадия | Работа | Часы |
|---|---|---|
| 0 | External setup (GCP, Telegram, Anthropic, n8n Cloud signup, MCP config) | 1 |
| 1 | Дополнение `project_specs.md` через диалог с Claude Code (Промпт 1) | 1.5 |
| 2 | Файловый scaffold (Промпт 2) | 1 |
| 3 | Воркфлоу 01 минимальный пайплайн (Промпт 3) | 4 |
| 4 | Воркфлоу 02 callback handler (Промпт 4) | 3 |
| 5 | Воркфлоу 03 error alerts + Apps Script (Промпт 5) | 2.5 |
| 6 | WOW 1 — AI qualification (Промпт 6) | 3 |
| 7 | WOW 2+3 — routing + reminders (Промпт 7) | 3.5 |
| 8 | Architecture doc + README + GIF + final QA (Промпт 8) | 2.5 |
| 9 | Опционально: синтетический генератор лидов (Промпт 9) | 1.5 |

Slip-day buffer заложен. Если Стадия 3 займёт 6 часов вместо 4 из-за credential-type бага — итог всё ещё ложится в четыре дня. Если ты на День 5 не закончил Стадию 8, ты scope-creep'нул — режь фичи, а не таймлайн.

---

## Поэтапная разбивка

Каждая стадия мапится на один промпт в `prompts.md`. Здесь — что происходит на operator-side: что проверять перед переходом, на чём обычно спотыкаются.

**Стадия 0 — External setup.** Браузерные манипуляции + sign up на n8n Cloud + установка MCP. Сильно короче, чем для self-hosted: нет Railway provisioning'а, нет Postgres setup'а, нет env vars block'а, нет генерации encryption key. Только: n8n.cloud sign up, генерация API key через UI, export shell env vars, создание `.mcp.json`. Готово когда: `n8n_health_check()` через MCP возвращает зелёный, и `n8n_list_workflows()` отдаёт пустой массив без ошибок.

**Стадия 1 — Планирование.** Ты приносишь `project_specs.md` с заполненными секциями, которые знаешь заранее (стек, Why-Cloud, production config, data model, message format, integration rules — всё что в `project_specs.md` помечено `[filled]`). Claude Code в Промпте 1 дозаполняет секции, помеченные `TBD via Prompt 1` — это node-by-node брейкдауны всех четырёх воркфлоу, drafts JavaScript для Function-узлов, открытые вопросы. Ты ревьюишь, аппрувишь, отвечаешь на Open Questions. Готово когда: `project_specs.md` секции 10–17 полные, Open Questions пустой или с твоими ответами.

**Стадия 2 — Scaffold.** Файловая структура создана, пустые placeholder'ы для воркфлоу-JSON, README и `docs/architecture.md` скелеты. `git status` показывает чистое дерево.

**Стадия 3 — Воркфлоу 01 минимальный пайплайн.** Самая длинная стадия — первый реальный контакт Claude Code с n8n через MCP. Sheets Trigger → Validate → Normalize → Lookup Existing → IF duplicate → Telegram Send → Sheets Update. Без AI, без routing. Только доказательство, что Form submission становится Telegram-уведомлением ≤60 сек, и что дубль — нет. Здесь почти гарантированно словишь credential-type gotcha (`googleSheetsTriggerOAuth2Api` vs `googleSheetsOAuth2Api`), подерёшься с regex'ом нормализации телефона, можешь забыть скаптурить `message_id` из Telegram-ответа. Бюджет 4 часа, принимай что может быть 6. Готово когда: Form submission → Telegram ≤60 сек, повторный submit с тем же email+phone не создаёт второго сообщения.

**Стадия 4 — Воркфлоу 02 callback handler.** Вторая половина дуплекса. Главный gotcha здесь — `additionalFields.updates` на Telegram Trigger должен включать `callback_query`. Дефолт — только `["message"]`. Без этого нажатия кнопок безмолвно исчезают. Если Claude Code забыл — твой ревью на operator-side должен это поймать. Готово когда: клик по любой кнопке обновляет Sheet ≤2 сек и редактирует Telegram-сообщение in-place. Двойной клик идемпотентен.

**Стадия 5 — Воркфлоу 03 error alerts.** Safety net. Любая ошибка где угодно пишет строку в `_errors` и шлёт email. Тестируется намеренной поломкой воркфлоу 01 (отключение Sheets credential). Опционально здесь же — Apps Script webhook для мгновенного ingest (~5 сек вместо 60 сек polling). Стоит делать ради snappy demo GIF. После создания workflow 03 — обязательный update на 01 и 02 через `n8n_update_partial_workflow` чтобы `settings.errorWorkflow` указывал на 03. Без этого error trigger в 03 никогда не услышит падений.

**Стадия 6 — WOW 1: AI qualification.** Claude Haiku между dedupe и Telegram. Score 1–10, категория hot/warm/cold, причина в 10 словах. Критический ход здесь — Parse AI Response **никогда не throw'ит**. На любую ошибку JSON-parse — fallback на `{score: 0, category: 'cold', reason: 'parse_error'}` и продолжать. Реальный лид должен достичь Telegram, даже если модель вернула garbage. `max_tokens=256` обязательно — иначе один плохой input разгоняет стоимость. Готово когда: hot/cold/adversarial тест-кейсы дают ожидаемые score'ы, и garbage-input не крашит воркфлоу.

**Стадия 7 — WOW 2 & 3: routing + reminders.** Switch-узел маршрутизирует лиды по budget tier в senior vs junior чат. Конфиг читается из `_config` вкладки один раз в начале воркфлоу — никогда не перечитывается. Воркфлоу 04: cron каждые 15 минут читает stale-лиды, шлёт один ping, выставляет `reminder_sent_at`. Без этого guard'а каждый cron-tick re-ping'ает тот же лид и менеджерский чат флудится. Готово когда: high-budget Form entry уходит в senior, low-budget — в junior; нерасклинутый лид получает ровно один reminder на 30-й минуте.

**Стадия 8 — Architecture doc + README + demo + final QA.** Под Cloud это короче, чем под self-hosted (нет 15-минутного setup-guide'а с Railway block'ами). Три deliverable: `docs/architecture.md` (портфолио-ориентированный архитектурный обзор, **не** redeploy guide), demo GIF (30–60 сек, ≤8 МБ), README (с GIF, Mermaid-диаграммой, case narrative, competencies блоком). Финал — production readiness gate из `project_specs.md` раздел 18.3 — под Cloud это всего 4 пункта вместо 5+ (нет encryption key check, нет volume mount check). Готово когда: всё в репозитории, restore drill пройден (одна workflow JSON импортируется в свежий тестовый workspace без ошибок).

**Стадия 9 (опционально) — Синтетический генератор лидов.** Если хочешь, чтобы Form URL ощущался «живым» при demo-recording — генератор с jitter'ом и маркером `is_demo: true`. **Важно для Cloud:** Faker.js на n8n Cloud недоступен (внешние npm модули заблокированы в Code-нодах, `NODE_FUNCTION_ALLOW_EXTERNAL` это self-hosted-only env var). Используй hand-rolled JS с массивами имён/сообщений вместо Faker.

---

## Quality gates — кратко

Формальные критерии живут в `project_specs.md` раздел 18. Здесь — operator-side discipline:

**Per-prompt gate.** После каждого промпта проверяешь: Claude Code отчитался о том что построил, `n8n_executions` показывает все узлы зелёными, workflow-level settings применены (timeout, save policy, errorWorkflow link), твой manual test (описан в конце каждого промпта в `prompts.md`) прошёл, `project_specs.md` обновлён с решениями принятыми в ходе сборки, ты ревьюишь diff и аппрувишь.

**Pipeline gate.** После Промпта 8 — полный end-to-end прогон: Form → Telegram ≤60 сек со всем (AI, routing), три кнопки работают, дубль фильтруется, stale reminder приходит ровно один, error path срабатывает на намеренной поломке credential, все четыре воркфлоу видны как active в Cloud UI.

**Production readiness gate (Cloud-вариант).** Четыре пункта вместо пяти+, потому что инфраструктурные концерны управляются Cloud'ом:
- Все воркфлоу имеют правильные workflow-level settings (timeout=300s, save-on-success=false, save-on-error=true, errorWorkflow linked to workflow 03)
- Каждый воркфлоу экспортирован в `workflows/NN-name.json` и закоммичен
- Restore drill пройден: один workflow JSON импортируется в свежий тестовый workspace без ошибок (валидация git как DR source)
- README имеет 30-секундный demo GIF и рабочую ссылку на `docs/architecture.md`

Если хоть один гейт красный — не двигайся. Это и есть дисциплина.

---

## Дисциплина процесса

Этот build — упражнение в systematic development. Что отличает его от просто «прокликать промпты»:

**Compound по чёткому циклу.** Между каждым промптом проходишь свой operator-side цикл: planning (compound plugin), execution (Claude Code через MCP), review (плюс ce-code-review агенты если нужно), encoding (что записать в `learnings.md`). Шаг encoding большинство команд скипают — и это единственный, который делает следующие итерации быстрее.

**`learnings.md` — твоя долгосрочная память.** Каждая запись 3–10 строк, датированная, тегированная (`#n8n`, `#telegram`, `#sheets`, `#claude-api`, `#mcp`, `#debugging`, `#cloud`). Когда Проект 2 столкнётся с тем же Sheets credential gotcha, `grep "#sheets" learnings.md` — твой shortcut к фиксу.

**`project_specs.md` растёт по ходу.** Каждая стадия добавляет в спеку реальные принятые решения — финальный phone regex, точный текст Telegram-сообщения, конкретный prompt для Claude Haiku, который выдал чистейший JSON. К концу проекта `project_specs.md` — это living документ, который сам собой превращается в blueprint для Проекта 2.

**Для Проекта 2** первое, что Claude Code читает — полный `learnings.md` Проекта 1 + новый `project_specs.md` Проекта 2 (который ты приносишь, опираясь на структуру первого). Уроки компаундируются. К Проекту 6 у тебя есть мастер-набор из паттернов, готовых snippet'ов и проверенных архитектурных решений — это самый ценный артефакт, которым ты владеешь.

Это loop, который превращает 22-часовой первый build в 10-часовой второй в 5-часовой пятый.

---

## Когда вещи ломаются

Несколько реалистичных failure modes под Cloud-вариант. Каждый из них — это будущая запись в `learnings.md`.

**«Воркфлоу создался, но не активируется» / «Active, но ничего не срабатывает».** Почти всегда credential mismatch. Открой воркфлоу в Cloud UI, проверь каждый credential dropdown — заполнен ли, совпадает ли тип (Trigger types отличаются от action types в Google Sheets). Для Telegram-trigger'ов deactivate и reactivate для refresh webhook-регистрации.

**«Telegram-кнопки ничего не делают».** `Telegram Trigger` → Additional Fields → Updates должен включать `callback_query`. Дефолт `["message"]`. Самый часто гугленный n8n-баг не просто так.

**«Anthropic вернул garbage и Function-нода крашнулась».** Parse AI Response не имеет try/catch с fallback. Чини сразу — реальный лид не должен блокироваться из-за модели.

**«Sheets polling занимает минуту и demo ощущается медленным».** Это floor для Sheets Trigger. Переключись на Apps Script webhook (`scripts/apps-script-webhook.gs`). Записывай demo GIF используя webhook-вариант.

**«MCP вызовы падают на authentication».** Почти всегда — `N8N_MCP_API_KEY` не установлен в shell, или `N8N_CLOUD_URL` неправильный. Проверь `echo $N8N_MCP_API_KEY` и `echo $N8N_CLOUD_URL`. API key создаётся через Cloud UI → Settings → n8n API. На Cloud публичный API всегда включён, отключить нельзя — env vars на n8n стороне не настраиваются.

**«MCP создал воркфлоу, но IF-нода routes обе ветки в один target».** `addConnection` нужен `branch: "true" | "false"` явно. Без этого default — оба идут к target.

**«Я добавил Faker.js в Code-ноду и оно не работает».** Cloud блокирует внешние npm модули в Code-нодах. `NODE_FUNCTION_ALLOW_EXTERNAL` — env var, доступный только на self-hosted. Используй hand-rolled JS вместо.

**«Voркфлоу превысил execution timeout».** Дефолт 5 минут на Cloud (300 секунд). Если воркфлоу легитимно нужно больше — увеличь в Workflow Settings, но сначала разберись почему нода висит — обычно это retry на упавший API без backoff'а.

Каждый из этих failure modes должен попасть в `learnings.md` с тегом `#debugging` после фикса. В следующем проекте `grep "#debugging" learnings.md` — твой шорткат к фиксам, которые ты уже знаешь.

---

## После Стадии 8 — что дальше

Портфолио-кейс живой. Три действия:

**Обнови портфолио-сайт.** Project card линкается на GitHub репо. Card зеркалит README: one-line value prop, GIF, competencies блок. Не заставляй читателей кликать в GitHub чтобы понять что ты построил.

**Напиши Freelancehunt proposal template.** Опираясь на реальные reference-проекты (1602755, 1582033, 1529887), задрафтай proposal со ссылкой на этот репо. Под 200 слов; начинай с архитектурных решений, которые волнуют клиента (idempotency, error handling, ≤60 сек notification SLA), не с технологий. Упомяни что для клиента с requirements на data residency система портабельна на self-hosted — это снимает потенциальный возражение.

**Compound the project, не закрывай его.** Перечитай `learnings.md` от начала до конца. Вытащи entries, которые генерализуются за пределы П1 — credential gotchas, JSON parse fallback, message_id capture pattern, Cloud-vs-self-hosted trade-offs. Они становятся seed'ом для `project_specs.md` Проекта 2.

Проект 2 стартует с 30-минутного review `learnings.md` Проекта 1 и 1-часового драфта `project_specs.md` под новый домен. Промпт 1 Проекта 2 включает: «Прочитай `learnings.md` из Проекта 1 перед планированием.» Это compound в действии.

---

## Резюме одним параграфом

Построй «Lead Automation» за 22 часа в 3–4 рабочих дня на n8n Cloud (Pro план). Стадия 1 — допиши `project_specs.md` через диалог с Claude Code; стадия 2 — scaffold; стадии 3–5 — собери core pipe в трёх воркфлоу; стадии 6–7 — уложи три WOW-фичи слоями; стадия 8 — architecture doc, README, deploy. Claude Code строит через n8n-MCP без диктовки кликов и без ручного импорта JSON. Ты между промптами планируешь, ревьюишь, тестируешь руками, фиксируешь уроки в `learnings.md` своим compound engineering процессом. Три quality gates — per-prompt, pipeline, production-readiness (Cloud-вариант) — пройдены прежде чем линковать с портфолио-сайта. Результат — фундамент для следующих пяти проектов, каждый шиппит быстрее предыдущего за счёт компаундированных уроков.
