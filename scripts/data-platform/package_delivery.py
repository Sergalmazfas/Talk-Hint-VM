"""Lossless delivery of the entire reviewed payload under Library's 100MiB cap.
No DB, import, source-data edits, removals or publication.
"""
import hashlib
import json
import lzma
import pathlib
import struct
import zipfile

out = pathlib.Path("generated-artifacts/data-platform-publish2")
pin = json.loads((out / "REVIEWED_PACKAGE.json").read_text())
manifest = json.loads((out / "MANIFEST.json").read_text())


class WideDictionary(zipfile.LZMACompressor):
    def _init(self):
        filters = {
            "id": lzma.FILTER_LZMA1,
            "dict_size": 128 * 1024 * 1024,
            "lc": 3, "lp": 0, "pb": 2,
            "mode": lzma.MODE_FAST, "mf": lzma.MF_HC3,
            "nice_len": 32, "depth": 8,
        }
        props = lzma._encode_filter_properties(filters)
        self._comp = lzma.LZMACompressor(lzma.FORMAT_RAW, filters=[filters])
        return struct.pack("<BBH", 9, 4, len(props)) + props


# Standard ZIP method 14, with explicit dictionary properties; no custom decoder.
zipfile.LZMACompressor = WideDictionary
target = out / "TalkHint_Publish2_review_full.zip"
sums = {}
notice = """

## Формат полного вложения

Исходный ZIP с gzip превысил лимит Library 100 МиБ. Данные НЕ урезаны.
Вместо gzip в этом ZIP лежит тот же полный **transfer.ndjson**, сжатый
стандартным ZIP-LZMA (method 14, словарь 128 МиБ).

`DELIVERY_TRANSPORT.json` связывает entry с исходным gzip и закреплённым
SHA распакованного потока. Сам gzip остаётся в Replit без изменений;
путь будущего приватного объекта и код импорта не менялись.

Для сверки используйте Python `zipfile.ZipFile(...).open("transfer.ndjson")`
и читайте блоками, НЕ `read()` всего entry: распакованный объём 1,35 ГБ.
У некоторых системных ZIP-просмотрщиков нет поддержки method 14.
Остальные файлы используют обычный Deflate. Это полный реальный пакет,
не только манифест и не выборка. Создание нового контейнера не удаляет старый.
"""

delivery = {
    "payloadEntry": "transfer.ndjson", "zipMethod": "ZIP_LZMA (14)",
    "dictionaryBytes": 128 * 1024 * 1024, "rawBytes": pin["ndjsonBytes"],
    "rawSha256": pin["fileSha256"], "recordCount": manifest["recordCount"],
    "maximumLineBytes": pin["maximumLineBytes"],
    "originalGzipRetained": "generated-artifacts/data-platform-publish2/transfer.ndjson.gz",
    "originalGzipReadback": "FILE_READBACK.json",
    "storageObjectUnchanged": pin["objectName"],
    "imported": False, "published": False, "truncated": False,
    "readInstructions": "Python ZipFile.open + block iteration, not a full in-memory read.",
}
with zipfile.ZipFile(out / "TalkHint_Publish2_review_v1.zip") as source, \
        zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    def small(name, content):
        z.writestr(name, content)
        sums[name] = hashlib.sha256(content).hexdigest()

    for name in source.namelist():
        if name in ["transfer.ndjson.gz", "SHA256SUMS.txt"]:
            continue
        content = source.read(name)
        if name == "README.md":
            content += notice.encode()
        if name == "source/.agents/memory/data-platform-verification.md":
            content = pathlib.Path(".agents/memory/data-platform-verification.md").read_bytes()
        small(name, content)
    small("source/scripts/data-platform/package_delivery.py", pathlib.Path(__file__).read_bytes())
    small("DELIVERY_TRANSPORT.json", json.dumps(delivery, ensure_ascii=False, indent=2).encode())
    info = zipfile.ZipInfo("transfer.ndjson")
    info.compress_type = zipfile.ZIP_LZMA
    info.file_size = pin["ndjsonBytes"]
    digest, size = hashlib.sha256(), 0
    with z.open(info, "w", force_zip64=True) as dest:
        envelope = (json.dumps({"manifest": manifest}, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        dest.write(envelope)
        digest.update(envelope)
        size += len(envelope)
        with (out / "records.ndjson").open("rb") as records:
            while chunk := records.read(1024 * 1024):
                dest.write(chunk)
                digest.update(chunk)
                size += len(chunk)
    assert size == pin["ndjsonBytes"]
    assert digest.hexdigest() == pin["fileSha256"]
    sums["transfer.ndjson"] = digest.hexdigest()
    small("SHA256SUMS.txt", "".join(f"{sha}  {name}\n" for name, sha in sorted(sums.items())).encode())

# Independent standard decoder, bounded RAM; verify ALL entries including payload.
with zipfile.ZipFile(target) as z:
    for name, expected in sums.items():
        digest = hashlib.sha256()
        with z.open(name) as f:
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
        assert digest.hexdigest() == expected, name
assert target.stat().st_size <= 100 * 1024 * 1024, "Still exceeds attachment cap; never upload a partial payload"
digest = hashlib.sha256()
with target.open("rb") as f:
    while chunk := f.read(1024 * 1024):
        digest.update(chunk)
receipt = {
    "file": str(target), "bytes": target.stat().st_size, "sha256": digest.hexdigest(),
    "entries": len(sums), "allEntryHashesVerified": True,
    "rawPayloadSha256": pin["fileSha256"], "recordCount": manifest["recordCount"],
    "imported": False, "published": False, "truncated": False,
}
(out / "DELIVERY_RECEIPT.json").write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2), flush=True)
