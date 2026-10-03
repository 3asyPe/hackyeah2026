1. Сервисы и инфраструктура
```mermaid
flowchart TB
    subgraph Browsers["Браузеры"]
        Client["Клиентский UI · React<br/>Отправка · Карта · Статус заявки"]
        Operator["UI оператора · React<br/>Инциденты · Review · Critical"]
    end

    subgraph Docker["Docker Compose"]
        ClientWeb["client-ui<br/>Nginx · статика React · proxy /api"]
        OperatorWeb["operator-ui<br/>Nginx · статика React · proxy /api"]
        API["api · FastAPI<br/>Заявки · Оценка · Группировка<br/>Review · Маршрутизация"]
        DB[("db · PostgreSQL")]
        Photos[("uploads volume<br/>Фотографии")]
        PGData[("pgdata volume<br/>Данные PostgreSQL")]
    end

    OpenAI["OpenAI API<br/>Оценка текста и изображения"]

    Client -->|"HTTP"| ClientWeb
    Operator -->|"HTTP"| OperatorWeb

    ClientWeb -->|"/api"| API
    OperatorWeb -->|"/api"| API

    API -->|"SQL"| DB
    API -->|"Чтение и запись файлов"| Photos
    API -->|"HTTPS · текст и фото"| OpenAI
    DB --- PGData
```
Сервис	Ответственность
client-ui	Обслуживает клиентский React UI, проксирует запросы /api
operator-ui	Обслуживает отдельный React dashboard оператора, проксирует /api
api	Проверяет данные, сохраняет заявки, вызывает OpenAI, группирует инциденты, применяет решения оператора
db	Хранит заявки, инциденты, оценки и историю решений
OpenAI API	Возвращает оценку; правила маршрутизации выполняет FastAPI


Фотографии сохраняются в uploads, в базе находятся их пути и метаданные. Для оценки FastAPI отправляет содержимое фотографии в OpenAI; публичное файловое хранилище не требуется.
Оба UI используют общий API и одну базу. Dashboard для драфта обновляется опросом API каждые несколько секунд. Симуляция уведомлений — модуль FastAPI.
2. Структура UI
UI	Экран	Содержание и действия
Клиент	Отправка заявки	Фото из камеры/галереи, описание, обязательные место и время, Submit
Клиент	Карта	Опубликованные инциденты, маркеры, категория, число опубликованных заявок, карточка инцидента
Клиент	Статус заявки	Processing / review / результат / ошибка; оценка модели, confidence, итоговое действие
Оператор	Обзор	Счётчики processing, review, failed и critical; список инцидентов
Оператор	Review	Очередь заявок, исходные фото и описание, причины проверки, approve/reject, выбор категории и уровней
Оператор	Critical	Инциденты с критическими заявками, связанные заявки и оценки
Оператор	Детали инцидента	Все связанные заявки, исходные доказательства, оценки, решения и симуляции
Оператор	Ошибки обработки	Заявки с failed; повторная обработка существующей заявки


```mermaid
flowchart LR
    subgraph ClientUI["Клиентский UI"]
        Form["Отправка"] --> Receipt["Статус заявки"]
        Map["Карта"] --> PublicDetail["Карточка инцидента"]
    end

    subgraph OperatorUI["UI оператора"]
        Overview["Обзор"] --> IncidentDetail["Детали инцидента"]
        ReviewQueue["Review"] --> ReportDetail["Детали заявки"]
        CriticalQueue["Critical"] --> IncidentDetail
        Failures["Ошибки"] --> ReportDetail
        IncidentDetail --> ReportDetail
        ReportDetail --> Decision["Approve / Reject / Retry"]
    end
```
У оператора карты нет. После успешной отправки клиент видит заявку только для чтения: исправление, удаление и повторная обработка ему недоступны.
3. Обработка заявки
```mermaid
flowchart TD
    Submit["Submit"] --> Validate["Проверить поля и submission_key"]
    Validate --> Save["Сохранить фото, заявку<br/>и приватный provisional incident"]

    Save --> Evidence{"Есть фото или описание?"}

    Evidence -->|"Нет"| Review["in_review"]
    Evidence -->|"Да"| LLM["Вызвать OpenAI"]

    LLM -->|"Ошибка API или невалидный ответ"| Failed["failed<br/>Сохранить ошибку попытки"]
    LLM -->|"Успех"| Assessment["Сохранить типизированную оценку"]

    Assessment --> Check{"Несовпадение,<br/>недостаточно данных<br/>или ничья confidence?"}
    Check -->|"Да"| Review
    Check -->|"Нет"| Route["Применить классификацию"]

    Review --> Operator{"Решение оператора"}
    Operator -->|"Reject"| Rejected["rejected"]
    Operator -->|"Approve"| Route

    Failed -->|"Retry оператором или системой"| LLM

    Route --> Group["Найти подходящий incident<br/>или активировать provisional"]
    Group --> Critical{"Severity high<br/>и urgency high?"}

    Critical -->|"Да"| CriticalResult["critical<br/>Dashboard оператора"]
    Critical -->|"Нет"| Published["published<br/>Карта клиентов"]

    Published --> High{"Severity high?"}
    High -->|"Да"| Simulation["Записать симуляцию<br/>уведомлений"]
    High -->|"Нет"| Done["Готово"]
```
OpenAI оценивает данные. FastAPI проверяет ответ и самостоятельно применяет правила review, critical и публикации.
4. ERD
Обозначение NN означает NOT NULL. Типы numeric уточнены в комментариях.
```mermaid
erDiagram
    INCIDENT ||--o{ REPORT : contains
    INCIDENT o|--o{ INCIDENT : merge_target
    REPORT ||--o{ ASSESSMENT : assessment_attempts
    REPORT ||--o{ REVIEW_DECISION : review_history
    ASSESSMENT o|--o{ REVIEW_DECISION : reviewed_assessment
    REPORT ||--o| NOTIFICATION_SIMULATION : simulation
    INCIDENT ||--o{ NOTIFICATION_SIMULATION : incident_snapshot

    REPORT {
        uuid id PK "NN"
        uuid submission_key UK "NN"
        bytea submission_hash "NN"
        bytea receipt_token_hash "NN"
        uuid incident_id FK "NN"
        uuid current_assessment_id FK "nullable"
        uuid current_review_id FK "nullable"
        report_status status "NN"
        text description "nullable"
        text photo_path "nullable"
        photo_media_type photo_media_type "nullable"
        integer photo_size_bytes "nullable"
        numeric latitude "NN numeric(9,6)"
        numeric longitude "NN numeric(9,6)"
        timestamptz incident_time "NN"
        timestamptz submitted_at "NN"
        timestamptz updated_at "NN"
        timestamptz processing_started_at "nullable"
        text review_reason "nullable"
    }

    INCIDENT {
        uuid id PK "NN"
        incident_state state "NN"
        uuid merged_into_id FK "nullable"
        incident_category category "nullable until classified"
        numeric latitude "NN numeric(9,6)"
        numeric longitude "NN numeric(9,6)"
        timestamptz incident_time "NN"
        timestamptz created_at "NN"
    }

    ASSESSMENT {
        uuid id PK "NN"
        uuid report_id FK "NN"
        integer attempt_no "NN"
        assessment_outcome outcome "NN"
        incident_category category "nullable"
        severity_level severity "nullable"
        urgency_level urgency "nullable"
        numeric severity_low_confidence "nullable numeric(5,2)"
        numeric severity_medium_confidence "nullable numeric(5,2)"
        numeric severity_high_confidence "nullable numeric(5,2)"
        numeric urgency_low_confidence "nullable numeric(5,2)"
        numeric urgency_medium_confidence "nullable numeric(5,2)"
        numeric urgency_high_confidence "nullable numeric(5,2)"
        consistency_result photo_description_match "nullable"
        photo_check_result scene_plausibility "nullable"
        photo_check_result time_consistency "nullable"
        photo_check_result manipulation_concerns "nullable"
        text explanation "nullable"
        text error_code "nullable"
        text error_message "nullable"
        text model "NN"
        text prompt_version "NN"
        timestamptz started_at "NN"
        timestamptz completed_at "NN"
    }

    REVIEW_DECISION {
        uuid id PK "NN"
        uuid report_id FK "NN"
        uuid assessment_id FK "nullable"
        review_action action "NN"
        incident_category final_category "nullable on reject"
        severity_level final_severity "nullable on reject"
        urgency_level final_urgency "nullable on reject"
        text operator_label "NN"
        text comment "nullable"
        timestamptz decided_at "NN"
    }

    NOTIFICATION_SIMULATION {
        uuid report_id PK,FK "NN"
        uuid incident_id FK "NN historical snapshot"
        integer radius_m "NN"
        integer recipient_count "NN"
        timestamptz simulated_at "NN"
    }
```
current_assessment_id и current_review_id — дополнительные ссылки из REPORT на выбранные записи истории. Их ограничения перечислены ниже; на диаграмме основные связи истории показаны отдельно.
5. Назначение таблиц
Таблица	Что хранит	Правило изменения
REPORT	Исходную заявку и текущий статус обработки	Доказательства неизменяемы; backend обновляет статус и служебные ссылки
INCIDENT	Группу заявок, исходную точку и время для сравнения	Provisional активируется или объединяется; координаты и время якоря сохраняются
ASSESSMENT	Завершённые попытки обращения к модели, включая ошибки	Каждая попытка — новая запись; прошлые оценки не перезаписываются
REVIEW_DECISION	Решение оператора и полную итоговую классификацию	Новая запись истории; исходная оценка модели сохраняется
NOTIFICATION_SIMULATION	Факт симуляции, радиус и число условных получателей	Одна историческая запись на заявку


Отдельные таблицы пользователей, фотографий и получателей для этого драфта не нужны: аккаунтов нет, фотография у заявки одна, получатели симулируются.
6. ENUM
PostgreSQL ENUM	Значения
severity_level	low, medium, high
urgency_level	low, medium, high
report_status	processing, in_review, published, critical, rejected, failed
incident_state	provisional, active, merged
assessment_outcome	succeeded, failed
review_action	approve, reject
consistency_result	matches, mismatches, inconclusive, not_applicable
photo_check_result	no_obvious_concerns, suspicious, inconclusive, not_applicable
photo_media_type	image/jpeg, image/png, image/webp
incident_category	Для драфта: fire_smoke, road_hazard, infrastructure_damage, waste_pollution, other


Это PostgreSQL ENUM и соответствующие enum в моделях FastAPI. Confidence хранится числовыми колонками NUMERIC(5,2). Типы ENUM, числовые типы PostgreSQL.
7. Ограничения данных
Область	Ограничение
Координаты	Latitude от −90 до 90, longitude от −180 до 180
Время	incident_time обязательно; отдельно от времени отправки
Фото	Путь, media type и размер либо заполнены вместе, либо все NULL; размер положительный
Хеши	submission_hash и receipt_token_hash — SHA-256, по 32 байта
Идемпотентность	UNIQUE(submission_key)
Попытки оценки	attempt_no > 0, UNIQUE(report_id, attempt_no)
Confidence	Каждое заполненное значение от 0 до 100; каждая тройка заполнена целиком либо целиком NULL
Неопределённый уровень	NULL, без подстановки low или фиктивного нуля confidence
Ошибка оценки	Для outcome=failed обязательна ошибка; поля результатов оценки остаются NULL
Успешная оценка	Заполнены результаты применимости проверок и объяснение
Approve	Обязательны final_category, final_severity, final_urgency
Reject	Итоговые поля классификации остаются NULL
Активный incident	Категория обязательна
Merge	merged_into_id заполнен только для merged, ссылка на себя запрещена
Симуляция	radius_m > 0, recipient_count >= 0; PK по report_id исключает повтор


Сумму confidence не ограничиваем числом 100: PRD требует проценты уверенности по уровням, но не определяет их как нормированное распределение вероятностей. Каждый набор показывается по убыванию значения.
Для служебных ссылок нужны составные внешние ключи:
- (REPORT.id, current_assessment_id) → (ASSESSMENT.report_id, ASSESSMENT.id).
- (REPORT.id, current_review_id) → (REVIEW_DECISION.report_id, REVIEW_DECISION.id).
- (REVIEW_DECISION.report_id, assessment_id) → (ASSESSMENT.report_id, ASSESSMENT.id).
На целевых парах создаются UNIQUE. Это исключает выбор оценки или решения от чужой заявки.
8. Правила целостности в FastAPI
1. Сохранение заявки. В одной транзакции создаются приватный provisional incident и связанный report. Начальная связь циклична не будет: incident не содержит обратного FK на report.
2. Идемпотентность. Повтор запроса с тем же submission_key и тем же содержимым возвращает существующую заявку. Другой payload с тем же ключом возвращает конфликт. Клиент сохраняет ключ и случайный receipt token до отправки, чтобы восстановить результат при потерянном ответе.
3. Неизменяемость. Описание, фото, координаты и время происшествия после отправки не изменяются. На уровне БД это можно закрепить триггером. Статусы и служебные ссылки меняются backend.
4. Классификация. При approve используются итоговые поля текущего решения оператора. Без решения — текущая успешная оценка модели. Группировка, critical и уведомления используют одну и ту же итоговую классификацию. UI отдельно показывает модельные confidence и решение оператора.
5. Review. Без обоих видов доказательств, при несовпадении фото/описания или неопределённой классификации заявка остаётся приватной. Для равных максимумов confidence принимаем правило драфта: in_review.
6. Группировка. Сначала применяются категория и пределы расстояния/времени, затем выбирается минимальный weighted score. Для равных score — стабильный выбор по ID. Для небольшого демо обработку группировки сериализуем транзакционной блокировкой PostgreSQL; вызов OpenAI выполняется до этой транзакции.
7. Повторная обработка. Retry создаёт новую попытку оценки существующего report. Для уже финализированных published, critical и rejected повтор возвращает существующий результат. Переклассификацию опубликованных заявок в этот драфт не включаем.
8. Видимость. Карта показывает incident, если в нём есть published report. Critical report сам на карте не публикуется. Если он связан с уже опубликованным инцидентом, существующий маркер сохраняется; клиентские детали содержат опубликованные заявки.
9. Счётчики. Dashboard считает все связанные заявки, клиентская карта — опубликованные. Отдельная колонка report_count не хранится.
10. Симуляция. Создаётся один раз при первой подходящей публикации: severity high, urgency не high. Запись — исторический результат симуляции, без фактической отправки уведомлений.
9. API между UI и backend
Endpoint	Кто использует	Назначение
POST /api/reports	Клиент	Отправить заявку и получить ID/статус
GET /api/reports/{id}	Клиент с receipt token	Получить read-only результат своей заявки
GET /api/incidents	Клиент	Получить опубликованные маркеры
GET /api/incidents/{id}	Клиент	Получить публичную карточку инцидента
GET /api/operator/summary	Оператор	Счётчики dashboard
GET /api/operator/reports	Оператор	Заявки с фильтрами по статусу
GET /api/operator/reports/{id}	Оператор	Доказательства, попытки оценки и решения
GET /api/operator/incidents	Оператор	Инциденты, включая critical
GET /api/operator/incidents/{id}	Оператор	Все связанные заявки
POST /api/operator/reports/{id}/review	Оператор	Approve/reject
POST /api/operator/reports/{id}/retry	Оператор	Повтор обработки существующей заявки


Операторские операции проверяются backend отдельно. Таблица аккаунтов для этого не требуется: в контролируемом демо достаточно отдельного операторского доступа.
10. Индексы и настройки
Индексы:
- REPORT(incident_id, status).
- REPORT(status, submitted_at).
- INCIDENT(category, incident_time) WHERE state = 'active'.
- ASSESSMENT(report_id, attempt_no) — уникальный.
- REVIEW_DECISION(report_id, decided_at).
Предлагаемые начальные настройки FastAPI:
Настройка	Значение для демо
Максимальное расстояние совпадения	200 м
Максимальная разница времени	60 мин
Вес расстояния	1
Вес времени	5
Радиус симулированных уведомлений	1000 м


score = distance_meters × 1
      + absolute_time_difference_minutes × 5
Настройки остаются конфигурируемыми. Для небольшого числа демонстрационных инцидентов достаточно PostgreSQL и расчёта расстояния в FastAPI.