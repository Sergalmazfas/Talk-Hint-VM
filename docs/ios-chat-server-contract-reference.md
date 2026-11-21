# Snapshot серверных контрактов для единой iOS-передачи

Проверено по серверному `45d8b0f18dcd65aa4900c5cfaa265be009752593`.
Это справка для DTO/mock-тестов; НЕ файл миграции, НЕ разрешение вызвать
провайдера/изменить сервер. В native-ветке сервер старее — её backend не запускать.
Актуальное задание: `claude-mac-ios-consolidated-handoff.md`.

## Сообщение чата

Существующий Message дополняется необязательным полем верхнего уровня:

```ts
presentation?: {
  revision: 1;
  format: "markdown";
  copyItems: Array<{
    kind: "address" | "phone" | "email" | "reference" | "code";
    value: string;
  }>;
  documentIds: string[];
};
```

Отсутствие поля у старых сообщений нормально. Будущие неизвестные значения
не должны обрушать список сообщений. copyItems — максимум 60, значение до 8000
символов; documentIds — максимум 10. Значение копируется как строка, не число.
Источник: `server/chat/answerPresentation.ts`, `contracts.ts`, `repository.ts`.

## Capabilities и read-aloud

`GET /api/chat-v1/capabilities` — обычный auth приложения.
Новые поля верхнего уровня; ниже перечислены известные поля, не весь ответ:

```ts
readAloud: {
  available: boolean;
  reason?: string | null;
  model?: string;
  dailyLimitUsd?: number;
  revision?: number;
  systemVoiceFallback?: string;
};
tables: {
  available: boolean;
  revision: 1;
  limits: {bytes: number; sheets: number; columns: number; rows: number};
  confirmationButtons: false;
  cargoIngestion: false;
};
```

readAloud.available вычисляется отдельно от voiceMode. В частности:
VOICE_OWNER_ONLY, READ_ALOUD_DISABLED, VOICE_NOT_SELECTED, ELEVENLABS_KEY_MISSING.
`systemVoiceFallback:"explicit_choice"` не означает разрешение автоматически
подменить ElevenLabs системным голосом. Этот handoff не добавляет такой fallback.

`GET /api/chat-v1/conversations/:id/messages/:messageId/read-aloud`:

```ts
{
  revision: 1;
  offsetEncoding: "utf-16";
  textHash: string;
  segments: Array<{offset: number; length: number}>;
}
```

На каждый сегмент `POST` на тот же URL:

```ts
{
  requestId: string; // UUID, отдельный на сегмент
  playbackId: string; // UUID, общий на одно Play
  offset: number; // целое >= 0, UTF-16 исходного сохранённого text
  length: number; // целое 1..600
}
```

Никаких дополнительных полей. `textHash` не входит в POST.
Транспорт: raw PCM s16le, 24000 Hz, mono. Не MP3.
Сегменты брать из manifest; текст для платного запроса задаёт сервер, а не iOS.
Нельзя повторять запрос с неизвестным расходом автоматически.
Источник: `server/chat/routes.ts`, `readAloud.ts`, `speech.ts`.

## Прикрепление таблицы

Существующий `POST /api/chat-v1/attachments`:

```ts
{
  clientRequestId: string; // UUID
  name: string;           // 1..180
  mimeType: string;
  dataBase64: string;
}
```

MIME таблиц: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`text/csv`. Лимит именно этих файлов 10*1024*1024 байт; остальные существующие
лимиты не повышать. `tables.limits`: 20 листов / 100 колонок / 50000 строк.
Прикрепление не является само по себе разрешением импортировать/менять таблицу.
Импорт по ясной пользовательской команде проходит через существующий чат.
Не фабриковать sourceMessageId или instructionQuote.
Источник: `server/chat/contracts.ts`, `routes.ts`, `server/tables/limits.ts`.

## Список и метаданные таблиц

Все URL относительно `/api/chat-v1`.

`GET /tables?search=...&offset=0&hidden=0`:

```ts
{
  books: Array<{
    id: string;
    name: string;
    scope: "personal" | "work" | "shared";
    revision: number;
    hidden: boolean;
    created_at: string;
    updated_at: string;
    downloadUrl: string;
  }>;
  more: boolean;
  nextOffset: number | null;
}
```

30 элементов на страницу, search до 160 символов. hidden принимает `"0"`/`"1"`.
bookId/columnId/sheetId — строки `[a-zA-Z0-9_-]{1,80}`, не обязательно UUID.
created_at/updated_at в этих ответах snake_case, не createdAt/updatedAt.

`GET /tables/:bookId` возвращает объект Workbook с id/revision/hidden/purged;
в sheets — id/name/columns и rowCount, **без массива rows**.
Для нативного минимума не нужен полный редактор ячеек/формул: изменения и запросы
идут через текстовый/голосовой чат и серверный вычислитель.

## Асинхронный экспорт

`POST /tables/:bookId/export`:

```ts
{conversationId: string; revision: number; requestId: string}
```

conversationId/requestId — UUID, revision — положительное целое.
Ответ 202:

```ts
{jobId: string; status: string; saved: false}
```

`saved:false` здесь — задание поставлено, НЕ ошибка и НЕ готовый XLSX.
`GET /tables/jobs/:jobId`:

```ts
{
  id: string;
  kind: string;
  status: string;
  result: unknown | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
```

Известны queued/running/complete/failed/purged; неизвестный статус не считать
успехом. Для успешного export result:

```ts
{revision: number; downloadUrl: string}
```

Приватный storageKey сервер вырезает. downloadUrl имеет вид
`/api/chat-v1/tables/exports/:jobId/download`; GET даёт XLSX с
Content-Disposition и X-TalkHint-Table-Revision. Не угадывать URL по bookId.

`GET /tables/:bookId/export` не создаёт задание:
- готовый экспорт текущей revision → 303 на download;
- иначе 409 `{error:"TABLE_EXPORT_REQUIRED",bookId,revision,createExportUrl}`;
- hidden/несуществующая/чужая таблица — отказ.

Ошибки включают TABLE_STALE_READ_AGAIN, TABLE_REQUEST_CONFLICT, TABLE_HIDDEN,
TABLE_EXPORT_NOT_READY. Не повторять POST новым requestId автоматически после
неизвестного результата; повтор того же намерения сохраняет requestId.

Источник: `server/tables/routes.ts`, `store.ts`, `service.ts`, `contracts.ts`.
## Импорт/сопоставление — через мозг чата, без нового native write-backend

Серверные tools: list_user_tables, read_user_table, query_user_table,
create_user_table, edit_user_table, list_table_templates, preview_table_import,
read_table_job, import_user_table, export_user_table.

preview_table_import принимает `{attachmentId:UUID}` и ставит preview-job.
read_table_job принимает `{jobId:UUID,sheetId?:string}`.
import_user_table принимает `{import:...,instructionQuote:string}`:

```ts
type ImportToolInput = { import: {
  attachmentId: string;
  name: string;
  scope?: "personal" | "work" | "shared";
  headers?: Record<string, number>; // 0=no header, иначе 1-based, до 50
  columns?: Record<string, Record<string, {
    name?: string;
    type?: "text" | "number" | "date" | "boolean";
    numberFormat?: "decimal_dot" | "decimal_comma";
    dateFormat?: "iso" | "mdy" | "dmy";
  }>>;
}; instructionQuote: string };
```

Модель/сервер делают предложение сопоставления в разговоре; дополнительных
Save-карточек таблиц не нужно. Запись требует реальную цитату из своего
user-message; native не подменяет её догадкой или скрытым tool-вызовом.
Архивирование cargo-документа не вызывает импорт/put_row автоматически.
