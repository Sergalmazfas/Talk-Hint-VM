import XCTest
@testable import TalkHint

final class ChatTablesTests: XCTestCase {
    func testFailedExportAllowsNewAttemptButUnknownOutcomeKeepsIdentity() {
        var attempts = ChatTableExportAttempts()
        let first = attempts.request(for: "book:1")
        attempts.remember(job: "job-1", for: "book:1")
        attempts.observed(status: "running", for: "book:1")
        XCTAssertEqual(attempts.request(for: "book:1"), first)
        XCTAssertEqual(attempts.job(for: "book:1"), "job-1")
        attempts.observed(status: "unknown", for: "book:1")
        XCTAssertEqual(attempts.request(for: "book:1"), first)
        attempts.observed(status: "failed", for: "book:1")
        XCTAssertNil(attempts.job(for: "book:1"))
        XCTAssertNotEqual(attempts.request(for: "book:1"), first)
    }
    func testExportFilenameUsesSafeTableTitle() {
        XCTAssertEqual(ChatTableExportAttempts.filename("Grace Personal Savings"), "Grace Personal Savings.xlsx")
        XCTAssertEqual(ChatTableExportAttempts.filename("Budget.xlsx"), "Budget.xlsx")
        let safe = ChatTableExportAttempts.filename("../Trip\\Costs:\n2026")
        XCTAssertFalse(safe.contains("/")); XCTAssertFalse(safe.contains("\\")); XCTAssertFalse(safe.contains("\n"))
        XCTAssertFalse(safe.hasPrefix("."))
        XCTAssertLessThan(ChatTableExportAttempts.filename(String(repeating: "🚛", count: 300)).utf8.count, 255)
    }
    func testTableErrorsHaveReadableLocalizedMessages() throws {
        for locale in ["ru", "es", "en"] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: locale, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            for code in ["TABLE_STALE_READ_AGAIN", "TABLE_HIDDEN", "TABLE_EXPORT_NOT_READY", "TABLE_EXPORT_FAILED"] {
                let text = ChatFeatureErrors.message(APIError.http(409, code), feature: .tables, bundle: bundle)
                XCTAssertFalse(text.contains("TABLE_")); XCTAssertFalse(text.hasPrefix("chat."))
                XCTAssertFalse(text.isEmpty)
            }
        }
    }
    private func caps() throws -> ChatCapabilities {
        try JSONDecoder().decode(ChatCapabilities.self, from: Data(#"{"ai":{"available":true},"attachments":{"available":true,"mimeTypes":["application/pdf"],"maxBytes":2097152},"voice":{"available":false},"tables":{"available":true,"limits":{"bytes":10485760,"sheets":20,"columns":100,"rows":50000}},"readAloud":{"available":true}}"#.utf8))
    }
    func testTableLimitIsSeparateFromPDFAndImages() throws {
        let c = try caps()
        XCTAssertEqual(ChatTableAttachmentPolicy.limit(mime: ChatTableAttachmentPolicy.xlsx, capabilities: c), 10 * 1024 * 1024)
        for mime in ["application/pdf", "image/png", "text/plain"] {
            XCTAssertEqual(ChatTableAttachmentPolicy.limit(mime: mime, capabilities: c), 2 * 1024 * 1024)
        }
        XCTAssertEqual(ChatTableAttachmentPolicy.limit(mime: "text/csv", capabilities: nil), 0)
        XCTAssertEqual(c.readAloud?.available, true)
    }
    func testTenMiBBase64JSONFitsDedicatedFourteenMiBParser() throws {
        let data = Data(repeating: 255, count: 10 * 1024 * 1024)
        let body = try JSONSerialization.data(withJSONObject: [
            "clientRequestId": UUID().uuidString, "name": "table.xlsx",
            "mimeType": ChatTableAttachmentPolicy.xlsx, "dataBase64": data.base64EncodedString()],
            options: [.withoutEscapingSlashes])
        XCTAssertLessThan(body.count, 14 * 1024 * 1024)
        XCTAssertGreaterThan(body.count, 10 * 1024 * 1024)
    }
    func testRealUploadBodyFitsAndOversizePDFNeverPosts() async throws {
        var posts = 0
        let api = APIClient(transport: { req in
            let body: String
            if req.httpMethod == "POST" {
                posts += 1
                XCTAssertLessThan(req.httpBody!.count, 14 * 1024 * 1024)
                let json = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
                XCTAssertEqual(Data(base64Encoded: json["dataBase64"] as! String)?.count, 10 * 1024 * 1024)
                body = #"{"attachment":{"id":"a","name":"table.xlsx","mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":10485760,"status":"ready"}}"#
            } else {
                body = #"{"ai":{"available":true},"attachments":{"available":true,"mimeTypes":["application/pdf"],"maxBytes":2097152},"voice":{"available":false},"tables":{"available":true,"limits":{"bytes":10485760,"sheets":20,"columns":100,"rows":50000}}}"#
            }
            return (Data(body.utf8), HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline" })
        _ = try await api.uploadChatAttachment(requestId: UUID(), name: "table.xlsx",
            mimeType: ChatTableAttachmentPolicy.xlsx, data: Data(repeating: 255, count: 10 * 1024 * 1024))
        do {
            _ = try await api.uploadChatAttachment(requestId: UUID(), name: "too-large.pdf",
                mimeType: "application/pdf", data: Data(repeating: 0, count: 2 * 1024 * 1024 + 1))
            XCTFail("PDF limit must stay 2 MiB")
        } catch {}
        XCTAssertEqual(posts, 1)
    }
    func testBearerDownloadRejectsOtherOriginsAndTraversalBeforeTransport() async throws {
        var calls = 0
        let api = APIClient(transport: { req in
            calls += 1
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer offline")
            return (Data([1, 2]), HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": ChatTableAttachmentPolicy.xlsx])!)
        }, tokenProvider: { "offline" })
        for path in ["https://evil.invalid/api/chat-v1/export", "//evil.invalid/api/chat-v1/export",
                     "/api/chat-v1/%2e%2e/secret", "/outside", "/api/chat-v1/../../secret"] {
            do { _ = try await api.chatBinary(path); XCTFail(path) } catch {}
        }
        XCTAssertEqual(calls, 0)
        _ = try await api.chatBinary("/api/chat-v1/tables/exports/job/download")
        XCTAssertEqual(calls, 1)
    }
    func testSearchAndExportUseAuthenticatedRevisionAndStableRequestId() async throws {
        let id = UUID(), conversation = UUID().uuidString.lowercased()
        let api = APIClient(transport: { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer offline")
            let response: String
            if req.httpMethod == "POST" {
                let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
                XCTAssertEqual(body["revision"] as? Int, 3)
                XCTAssertEqual(body["requestId"] as? String, id.uuidString.lowercased())
                XCTAssertEqual(body["conversationId"] as? String, conversation)
                response = #"{"jobId":"job","status":"queued"}"#
            } else {
                XCTAssertTrue(req.url!.query!.contains("hidden=0"))
                response = #"{"books":[{"id":"book_1","name":"Savings","scope":"personal","revision":3,"hidden":false}],"more":false,"nextOffset":null}"#
            }
            return (Data(response.utf8), HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline" })
        let page = try await api.chatTables(search: "Savings")
        XCTAssertEqual(page.books.count, 1)
        let receipt = try await api.chatExportTable(page.books[0], conversationId: conversation, requestId: id)
        XCTAssertEqual(receipt.status, "queued")
        XCTAssertThrowsError(try APIClient.tableID("../other"))
    }
}
