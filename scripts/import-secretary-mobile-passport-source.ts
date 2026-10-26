/**
 * Explicit Dev-only documentation import. No app/provider/network operations.
 * Default validates; --save writes existing model documents with history.
 */
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { unpackModel, activeModelSize } from "../server/projectModel/history";
import { modelSizeBudget } from "../server/projectModel/sizeBudget";
import { persistModelUpdate } from "../server/projectModel/materialImport";
import { applyHypothesisCommand, readHypothesis } from "../server/projectModel/hypotheses";
import { productBookDocumentId, productBookText, readProductBook } from "../shared/productBook";
import { ProductCrewService } from "../server/productCrew/service";
import type { ModelCommand, ProjectModelState } from "../shared/projectModel";

const archive = "attached_assets/TalkHint_Backend_Documentation_2026-10-26_1793038223359.zip";
const prefix = "TalkHint_Backend_Documentation/";
const sourceId = "DOC-TALKHINT-SECRETARY-MOBILE-EXTERNAL-SNAPSHOT";
const techId = "DOC-TALKHINT-TECHNICAL-PASSPORT";
const roadmapId = "DOC-d4cd67c1-c2ec-4cc1-9dd7-3a4de41ec57d";
const outDir = "generated-artifacts/product-passport";
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const entry = (name: string) => execFileSync("unzip", ["-p", archive, prefix + name], { maxBuffer: 2_000_000 });
const now = new Date().toISOString();
const actor = "Replit · ручной импорт документации внешнего клиента по поручению Сергея, Dev";

async function exportSaved(state: ProjectModelState, owner: string, sha: string, expected: { name: string; sha256: string }[]) {
  const doc = (id: string) => { const d = state.documents.find(d => d.id === id); assert.ok(d, id); return d; };
  const book = readProductBook(doc(productBookDocumentId))!;
  assert.ok(book && doc(sourceId).text.includes(sha));
  assert.ok(doc(sourceId).text.includes(entry("README.md").toString("utf8")));
  assert.ok(doc(sourceId).text.includes(entry("Connections.csv").toString("utf8")));
  const service = new ProductCrewService({ read: async () => state, update: async () => { throw Error("Read only"); } });
  for (const documentId of [sourceId, productBookDocumentId, techId, roadmapId]) {
    const result: any = await service.call(owner, "get_document", { documentId });
    assert.equal(result.text, doc(documentId).text);
    assert.equal(result.revision, state.revision);
  }
  const packet = { format: "talkhint.product-passport", exportedAt: now, revision: state.revision,
    book, technicalPassport: doc(techId), externalSource: doc(sourceId), roadmap: doc(roadmapId),
    sourceArchive: { path: archive, sha256: sha, files: expected },
    verification: { readback: true, getDocumentSameText: true, sourceComplete: true,
      originalHypothesisUnchanged: true, rolesAndActionsUnchanged: true, competitorsUnchanged: true,
      providersNotCalled: true, productionNotModified: true, externalRuntimeNotVerified: true } };
  await mkdir(outDir, { recursive: true });
  const stem = `TalkHint_product_passport_v${book.version}_rev${state.revision}`;
  await writeFile(`${outDir}/${stem}.json`, JSON.stringify(packet, null, 2) + "\n");
  await writeFile(`${outDir}/${stem}_external-source.md`, doc(sourceId).text);
  console.log(JSON.stringify({ savedRevision: state.revision, getDocumentVerified: 4, sourceComplete: true,
    packagePath: `${outDir}/${stem}.json` }));
}

async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).hostname, /^(helium|lithium)$/);
  const original = await readFile(archive);
  const sha = hash(original);
  const markdown = entry("README.md").toString("utf8");
  const csv = entry("Connections.csv").toString("utf8");
  const sums = entry("SHA256SUMS.txt").toString("utf8");
  const expected = sums.trim().split("\n").map(line => {
    const match = /^([a-f0-9]{64})  (README\.md|Connections\.csv|TalkHint_Backend_Overview\.html)$/.exec(line);
    assert.ok(match, "Unexpected manifest entry");
    assert.equal(hash(entry(match[2])), match[1], `Checksum mismatch: ${match[2]}`);
    return { name: match[2], sha256: match[1] };
  });
  assert.equal(expected.length, 3);
  assert.ok(markdown.includes("## 17.") && markdown.includes("Expo SDK 57"));
  assert.ok(!/(?:sk-(?:proj-|ant-)[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^ \n]+@)/.test(markdown + csv),
    "Potential credential; stop rather than import");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const q = await pool.query(`SELECT owner_key,state FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
    assert.equal(q.rows.length, 1);
    const owner = q.rows[0].owner_key;
    const before = await unpackModel(pool, owner, q.rows[0].state);
    const state = readHypothesis(before, "new-country");
    const doc = (id: string) => { const d = state.documents.find(d => d.id === id); assert.ok(d, id); return d; };
    if (process.argv.includes("--export-existing")) {
      await exportSaved(state, owner, sha, expected);
      return;
    }
    assert.ok(!state.documents.some(d => d.id === sourceId || d.text.includes(sha)), "Source already registered: read it, do not duplicate");
    const book = structuredClone(readProductBook(doc(productBookDocumentId))!);
    assert.ok(book && book.version >= 4);
    const oldFeatureIds = book.features.map(f => f.id);
    const sourceText = `# TalkHint — документация внешнего Secretary Mobile
Версия приложения к паспорту: 1. Получено: ${now}.
Дата документа-источника: 26.10.2026. Статус: источник сохранён; на согласовании, не пользовательская приёмка.
Связанные записи: ${productBookDocumentId}; ${techId}; ${roadmapId}; ENG-REQ-IOS-EVIDENCE.
Архив: ${archive}
SHA-256 архива: ${sha}

## Границы доказательств и сопоставление
Это переданный владельцем отчёт другого workspace, не полученные нами его исходники или доступ к тому окружению. Маркеры «КОД», «HANDOFF», «ВЛАДЕЛЕЦ» ниже — квалификация автора источника. Мы проверили целостность файлов, прочитали описание и сопоставили границы с текущим проектом. Все 17 разделов исходного README и реестр соединений сохранены ниже без сокращений.
1. Источник описывает отдельный мобильный клиент, его шаблонный /api/healthz и сервер раздачи Expo; это не отдельный Secretary Engine. Указан основной backend https://talkhint.app. Локальное описание шаблонного API не переносится на основной backend.
2. Внешний workspace заявляет Expo SDK 57 / React Native 0.86.3. Наша apps/secretary-mobile/package.json содержит Expo ~54.0.0. Это разные копии/этапы клиента, не основание автоматически менять зависимости, bundle ID или объявлять синхронизацию.
3. В отчёте приведены Apple metadata 0.1.0 (2), bundle app.replit.talkhintsecretary, Validated, minimum iOS 16.4. Исходные Apple metadata и скриншот не включены в этот архив. Текущая установленная сборка, TestFlight-доступ и runtime origin не подтверждены нами. Локальный bundle com.talkhint.secretaryclient.dev не исправляется автоматически.
4. Успешные вход/выход/повторный вход цитируются автором из сообщения владельца. Это историческое свидетельство, не наш текущий device-тест. Указанные 19 клиентских тестов и backend 1818/27/35 проверок — отчётные исторические сведения, не новые прогоны здесь.
5. Наш server/mobileSecretary/live.ts импортирует secretaryBackend из ../chatgpt/secretary и dialSecretaryTask из ../secretary/dialer: общая связь подтверждена чтением этих импортов, не production-вызовом. server/mobileSecretary/routes.ts содержит strict-origin для browser approval. Это не проверка заголовков развёрнутой версии.
6. Retell/ElevenLabs «не найдены в клиенте» не значит «отсутствуют в основном TalkHint». Старое HANDOFF-описание OpenAI не отменяет других путей/провайдеров основного проекта. Транспорт и модель уточняются по конкретному сценарию и версии.
7. TEST/LIVE, read/review/confirm и восстановление одного ID описаны источником. Не выполнялись реальные подтверждения, звонки, вход в чужое окружение, запросы к production-данным, миграции, настройки или публикации. Подключение календаря не равно бронированию; техническая очистка 24h не равна хранению истории звонков.
8. Supabase/Twilio MCP у Agent не доказывает runtime-интеграцию; local health не доказывает готовность общего backend.

## Правило дальнейших изменений — поручение владельца
Не менять продукт ради данного импорта. При будущей согласованной правке продукта отмечать затронутые возможности/компоненты паспорта: было/стало, источник/версия/дата, проверка, ограничения, принимающий. Не объявлять паспорт актуальным без этих данных. Автоматического наблюдения за другим workspace или будущими разговорами нет: его изменения должны быть переданы сюда новым источником. Текущая операция сохраняет только документацию.

## Исходный README — полный текст

${markdown}

## Исходный Connections.csv — полный реестр
\`\`\`csv
${csv}
\`\`\`

## Контрольные суммы оригинальных файлов
\`\`\`
${sums}
\`\`\`
HTML сохранён без изменений в исходном ZIP, это ещё одно представление документа, не отдельный продуктовый каталог.
`;
    assert.ok(sourceText.includes(markdown) && sourceText.includes(csv));
    assert.ok(sourceText.length <= 50000);
    book.version++;
    book.updatedAt = now;
    book.status = "На согласовании";
    const prior = "Отдельный сервер второго приложения из вложения не установлен: клиентская документация указывает talkhint.app, Secretary Engine найден здесь.";
    assert.ok(book.contradictions.includes(prior));
    book.contradictions = book.contradictions.replace(prior,
      `Получен внешний паспорт клиента: ${sourceId} v1. Это отдельный Secretary Mobile → talkhint.app, не доказательство другого Engine. SDK 57 и Apple 0.1.0(2) — сведения источника, не проверка нашей копии.`);
    book.responsibilities += "\nДокументация внешнего клиента связана ниже. Его изменения передавать в паспорт; автосинхронизации нет.";
    book.nextStage = book.nextStage.replace("технический паспорт v2", "технический паспорт v3");
    book.features.find(f => f.id === "secretary")!.platform =
      `Swift iOS; здешний Expo SDK54; внешний SDK57 — по отчёту ${sourceId}. Apple 0.1.0(2) — metadata из отчёта, не текущая установленная сборка. Backend talkhint.app. Техпаспорт v3.`;
    const roadmapVersion = Number(/— v(\d+)/.exec(doc(roadmapId).title)?.[1]) + 1;
    assert.ok(Number.isSafeInteger(roadmapVersion));
    book.roadmap = book.roadmap.replace(/сборка паспорта v4; единый roadmap v18/, `сборка паспорта v${book.version}; единый roadmap v${roadmapVersion}`);
    book.contradictions = book.contradictions.replace(/актуальная связанная запись — v18/, `актуальная связанная запись — v${roadmapVersion}`);
    const technicalVersion = Number(/— v(\d+)/.exec(doc(techId).title)?.[1]) + 1;
    assert.equal(technicalVersion, 3, "Reconcile if a newer technical passport exists");
    const bookText = productBookText(book);
    const techText = doc(techId).text + `\n\n## Дополнение v3, 26.10.2026\nВнешний Secretary Mobile: ${sourceId} v1; это клиент, не новый Engine. Исходник сохранён целиком. Изменения отражать в паспорте; автосинхронизации другого проекта нет.`;
    assert.ok(bookText.length <= 50000, `Book size ${bookText.length}`);
    assert.ok(techText.length <= 50000, `Technical size ${techText.length}`);
    const commands: ModelCommand[] = [
      { type: "createDocument", id: sourceId, title: "TalkHint — внешний Secretary Mobile — полный источник и сопоставление — v1 — на согласовании",
        text: sourceText, url: doc(techId).url, elementIds: doc(techId).elementIds },
      { type: "saveDocument", id: productBookDocumentId, title: `TalkHint — живая книга продукта — v${book.version} — внешний клиент учтён — на согласовании`,
        text: bookText, url: doc(productBookDocumentId).url, elementIds: doc(productBookDocumentId).elementIds },
      { type: "saveDocument", id: techId, title: `TalkHint — технический паспорт и главный инженер — v${technicalVersion} — внешний клиент учтён — на согласовании`,
        text: techText, url: doc(techId).url, elementIds: doc(techId).elementIds },
      { type: "saveDocument", id: roadmapId, title: `TalkHint — единый roadmap — v${roadmapVersion} — текущий фокус: сборка паспорта`,
        text: doc(roadmapId).text + `\n\n## Внешний Secretary Mobile — источник получен ${now}\n${sourceId} v1: весь README (17 разделов), Connections.csv и контрольные суммы сохранены. Связаны с книгой v${book.version} и техпаспортом v3. Переданный проект — клиент, не новый сервер Engine. Apple metadata и SDK различаются со здешним клиентом; конфигурацию не менять автоматически. Этап получения внешней документации выполнен; проверка её актуальности на устройстве не выполнена. Следующий один шаг остаётся ENG-REQ-IOS-EVIDENCE: фактическая версия/build/API origin установленного клиента и сопоставление с указанными копиями, без звонка. Затем сверка недостающих доказательств и согласование паспорта. Ресурсы/приёмка ролей не имитируются. При дальнейших правках обновлять паспорт с источником, датой и результатом проверки; внешний workspace автоматически не наблюдается.`,
        url: doc(roadmapId).url, elementIds: doc(roadmapId).elementIds },
    ];
    let updated = before;
    for (const command of commands) updated = applyHypothesisCommand(updated, "new-country", command, actor);
    const next = readHypothesis(updated, "new-country");
    for (const key of ["elements", "relations", "operatingModel", "competitorDirectory", "analystPreparation", "proposals"] as const)
      assert.deepEqual(next[key], state[key], `No changes to ${key}`);
    assert.deepEqual(book.features.map(f => f.id), oldFeatureIds);
    assert.equal(book.previousPassport, readProductBook(doc(productBookDocumentId))!.previousPassport);
    for (const old of state.documents.filter(d => !commands.some(c => c.type === "saveDocument" && c.id === d.id)))
      assert.deepEqual(next.documents.find(d => d.id === old.id), old);
    const withoutAlternatives = (r: typeof before) => { const { alternatives, revision, ...rest } = r; return rest; };
    assert.deepEqual(withoutAlternatives(updated), withoutAlternatives(before));
    for (const other of before.alternatives!.filter(h => h.id !== "new-country"))
      assert.deepEqual(updated.alternatives!.find(h => h.id === other.id), other);
    assert.ok(activeModelSize(updated) <= modelSizeBudget(updated));
    console.log(JSON.stringify({ mode: process.argv.includes("--save") ? "save" : "validate",
      fromRevision: before.revision, toRevision: updated.revision, bookVersion: book.version, technicalVersion,
      roadmapVersion, sourceId, sourceChars: sourceText.length, bookChars: bookText.length, technicalChars: techText.length,
      archiveEntriesVerified: expected.length, immutableSourceSha256: sha }));
    if (!process.argv.includes("--save")) return;
    const saved = await persistModelUpdate(pool, owner, actual => {
      assert.deepEqual(actual, before, "Concurrent update: abort");
      return updated;
    }, true);
    assert.deepEqual(readHypothesis(saved, "new-country"), JSON.parse(JSON.stringify(next)));
    await exportSaved(readHypothesis(saved, "new-country"), owner, sha, expected);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
