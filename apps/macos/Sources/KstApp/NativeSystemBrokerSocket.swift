import Foundation
import Darwin
import Security
import KstNativeCore

public struct NativeBrokerFault: Error, LocalizedError, Sendable {
    public let code: String
    public let message: String
    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
    public var errorDescription: String? { message }
}

/// Full-duplex owner-only Unix socket server (`b.sock`) that multiplexes:
/// 1. Request/response calls for `AppleEcosystemBroker` (`apple.execute`, `apple.status`)
/// 2. Streaming LLM inference turns (`llm.infer.start`, `llm.infer.cancel`) with
///    bidirectional `core.tool.execute` callbacks to the Node.js core authority.
/// All payloads cross concurrency boundaries as `Data` to satisfy strict Swift 6 Sendable checking.
final class NativeSystemBrokerSocket: @unchecked Sendable {
    let bootstrap: NativeBrokerBootstrap
    private let directory: String
    private let descriptor: Int32
    private let lock = NSLock()
    private var stopped = false
    private var clients = 0
    private let requestHandler: @Sendable (String, Data, NativeSocketStreamContext) async throws -> Data

    init(
        requestHandler: @escaping @Sendable (String, Data, NativeSocketStreamContext) async throws -> Data
    ) throws {
        self.requestHandler = requestHandler
        var random = Data(count: 32)
        guard random.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }) == errSecSuccess else {
            throw NativeBrokerFault(code: "RANDOM_FAILED", message: "Secure random source unavailable.")
        }
        directory = "/private/tmp/kst-\(getuid())-" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let path = directory + "/b.sock"
        guard path.utf8.count < 104 else {
            throw NativeBrokerFault(code: "BROKER_PATH_INVALID", message: "Native broker socket path is too long.")
        }
        guard mkdir(directory, 0o700) == 0 else {
            throw NativeBrokerFault(code: "BROKER_UNAVAILABLE", message: "Could not create private broker directory.")
        }
        var info = stat()
        guard lstat(directory, &info) == 0,
              info.st_uid == getuid(),
              info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o777 == 0o700 else {
            throw NativeBrokerFault(code: "BROKER_UNAVAILABLE", message: "Broker directory ownership is invalid.")
        }
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            rmdir(directory)
            throw NativeBrokerFault(code: "BROKER_UNAVAILABLE", message: "Could not create native broker socket.")
        }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            buffer.initializeMemory(as: UInt8.self, repeating: 0)
            buffer.copyBytes(from: Array(path.utf8) + [0])
        }
        let socketDescriptor = descriptor
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(descriptor, 24) == 0 else {
            Darwin.close(descriptor)
            unlink(path)
            rmdir(directory)
            throw NativeBrokerFault(code: "BROKER_UNAVAILABLE", message: "Could not bind native broker socket.")
        }
        bootstrap = NativeBrokerBootstrap(socketPath: path, capability: random.base64EncodedString())
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }
    }

    func stop() {
        lock.lock()
        let first = !stopped
        stopped = true
        lock.unlock()
        if first {
            Darwin.shutdown(descriptor, SHUT_RDWR)
            unlink(bootstrap.socketPath)
            rmdir(directory)
        }
    }

    deinit { stop() }

    private func acceptLoop() {
        defer { Darwin.close(descriptor) }
        while true {
            if lock.withLock({ stopped }) { return }
            let peer = Darwin.accept(descriptor, nil, nil)
            if peer < 0 { return }
            var uid = uid_t(), gid = gid_t()
            lock.lock()
            let allow = !stopped && clients < 24 && getpeereid(peer, &uid, &gid) == 0 && uid == getuid()
            if allow { clients += 1 }
            lock.unlock()
            guard allow else {
                Darwin.close(peer)
                continue
            }
            let connection = NativeBrokerConnection(peer, expectedCapability: bootstrap.capability)
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else {
                    connection.finish()
                    return
                }
                Task {
                    defer {
                        connection.finish()
                        self.lock.withLock { self.clients -= 1 }
                    }
                    await connection.serve(handler: self.requestHandler)
                }
            }
        }
    }
}

/// Provides streaming token delta emission and reverse `core.tool.execute` callbacks
/// during an active `llm.infer.start` session on `NativeSystemBrokerSocket`.
final class NativeSocketStreamContext: @unchecked Sendable {
    private let connection: NativeBrokerConnection
    let requestId: String
    private let lock = NSLock()
    private var cancelled = false

    init(connection: NativeBrokerConnection, requestId: String) {
        self.connection = connection
        self.requestId = requestId
    }

    var isCancelled: Bool {
        lock.withLock { cancelled }
    }

    func markCancelled() {
        lock.withLock { cancelled = true }
    }

    func emitDelta(_ delta: String) {
        guard !isCancelled, !delta.isEmpty else { return }
        try? connection.sendJSON([
            "type": "llm.infer.delta",
            "id": requestId,
            "textDelta": delta
        ])
    }

    func executeCoreTool(turnId: String, kind: String, arguments: [String: String]) async throws -> String {
        guard !isCancelled else {
            throw NativeBrokerFault(code: "TURN_CANCELLED", message: "Turn was interrupted.")
        }
        let toolCallId = "tc_" + String(UUID().uuidString.prefix(8))
        let argsData = (try? JSONSerialization.data(withJSONObject: arguments)) ?? Data("{}".utf8)
        let responseData: Data
        do {
            responseData = try await connection.sendReverseToolCall(
                parentId: requestId,
                turnId: turnId,
                toolCallId: toolCallId,
                kind: kind,
                argsData: argsData
            )
        } catch {
            let errObj: [String: String] = [
                "status": "error",
                "code": "BROKER_TOOL_ERROR",
                "message": error.localizedDescription
            ]
            if let data = try? JSONSerialization.data(withJSONObject: errObj),
               let str = String(data: data, encoding: .utf8) {
                return str
            }
            return "{\"status\":\"error\",\"message\":\"Tool call failed.\"}"
        }
        guard let response = (try? JSONSerialization.jsonObject(with: responseData)) as? [String: Any] else {
            return "{\"status\":\"ok\"}"
        }
        // Return structured JSON errors to LanguageModelSession instead of throwing a Swift error
        // that aborts the entire FoundationModels session turn.
        if let status = response["status"] as? String, status == "error",
           let err = response["error"] as? [String: Any] {
            let errPayload: [String: String] = [
                "status": "error",
                "code": err["code"] as? String ?? "TOOL_FAILED",
                "message": err["message"] as? String ?? "Tool execution could not complete."
            ]
            if let data = try? JSONSerialization.data(withJSONObject: errPayload),
               let text = String(data: data, encoding: .utf8) {
                return text
            }
            return "{\"status\":\"error\",\"message\":\"Tool execution could not complete.\"}"
        }
        if let output = response["output"] {
            if let data = try? JSONSerialization.data(withJSONObject: output),
               let text = String(data: data, encoding: .utf8) {
                return text
            }
            return String(describing: output)
        }
        return "{\"status\":\"ok\"}"
    }
}

final class NativeBrokerConnection: @unchecked Sendable {
    private let fd: Int32
    private let expectedCapability: String
    private let writeLock = NSLock()
    private let stateLock = NSLock()
    private var closed = false
    private var pendingToolContinuations: [String: CheckedContinuation<Data, Error>] = [:]
    private var activeContexts: [String: NativeSocketStreamContext] = [:]

    init(_ fd: Int32, expectedCapability: String) {
        self.fd = fd
        self.expectedCapability = expectedCapability
        var seconds = timeval(tv_sec: 20, tv_usec: 0)
        withUnsafePointer(to: &seconds) {
            _ = setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
            _ = setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        var yes: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
    }

    func finish() {
        let continuations: [CheckedContinuation<Data, Error>] = stateLock.withLock {
            guard !closed else { return [] }
            closed = true
            for (_, ctx) in activeContexts { ctx.markCancelled() }
            activeContexts.removeAll()
            let all = Array(pendingToolContinuations.values)
            pendingToolContinuations.removeAll()
            Darwin.shutdown(fd, SHUT_RDWR)
            Darwin.close(fd)
            return all
        }
        for c in continuations {
            c.resume(throwing: NativeBrokerFault(code: "BROKER_CLOSED", message: "Socket closed during tool call."))
        }
    }

    func serve(
        handler: @escaping @Sendable (String, Data, NativeSocketStreamContext) async throws -> Data
    ) async {
        while !stateLock.withLock({ closed }) {
            guard let frameData = try? readFrame() else { break }
            guard GoogleStrictJSON.valid(frameData),
                  let obj = (try? JSONSerialization.jsonObject(with: frameData)) as? [String: Any] else {
                break
            }
            let capability = obj["capability"] as? String ?? ""
            guard GoogleNativePolicy.constantTimeEqual(capability, expectedCapability) else {
                if let id = obj["id"] as? String {
                    try? sendJSON(["id": id, "error": ["code": "UNAUTHORIZED_BROKER", "message": "Invalid broker capability."]])
                }
                break
            }
            let method = obj["method"] as? String ?? ""
            let id = obj["id"] as? String ?? UUID().uuidString
            let paramsDict = obj["params"] as? [String: Any] ?? [:]
            let paramsData = (try? JSONSerialization.data(withJSONObject: paramsDict)) ?? Data("{}".utf8)

            if method == "core.tool.result" {
                let toolCallId = paramsDict["toolCallId"] as? String ?? id
                let cont = stateLock.withLock { pendingToolContinuations.removeValue(forKey: toolCallId) }
                cont?.resume(returning: paramsData)
                continue
            }

            if method == "llm.infer.cancel" {
                stateLock.withLock {
                    for (_, ctx) in activeContexts { ctx.markCancelled() }
                }
                continue
            }

            let context = NativeSocketStreamContext(connection: self, requestId: id)
            stateLock.withLock { activeContexts[id] = context }
            Task {
                defer { _ = self.stateLock.withLock { self.activeContexts.removeValue(forKey: id) } }
                do {
                    let resultData = try await handler(method, paramsData, context)
                    let resultObj = (try? JSONSerialization.jsonObject(with: resultData)) ?? [:]
                    try? self.sendJSON(["id": id, "result": resultObj])
                } catch let fault as NativeBrokerFault {
                    try? self.sendJSON(["id": id, "error": ["code": fault.code, "message": fault.message]])
                } catch {
                    try? self.sendJSON(["id": id, "error": ["code": "BROKER_FAILED", "message": error.localizedDescription]])
                }
            }
            if method != "llm.infer.start" {
                try? await Task.sleep(for: .milliseconds(5))
            }
        }
    }

    func sendReverseToolCall(
        parentId: String,
        turnId: String,
        toolCallId: String,
        kind: String,
        argsData: Data
    ) async throws -> Data {
        return try await withCheckedThrowingContinuation { continuation in
            stateLock.withLock {
                pendingToolContinuations[toolCallId] = continuation
            }
            do {
                let argsObj = (try? JSONSerialization.jsonObject(with: argsData)) ?? [:]
                try sendJSON([
                    "type": "core.tool.execute",
                    "rpcId": toolCallId,
                    "parentRpcId": parentId,
                    "turnId": turnId,
                    "toolCallId": toolCallId,
                    "kind": kind,
                    "args": argsObj
                ])
            } catch {
                let removed = stateLock.withLock { pendingToolContinuations.removeValue(forKey: toolCallId) }
                removed?.resume(throwing: error)
            }
        }
    }

    func sendJSON(_ dictionary: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: dictionary)
        guard data.count <= GoogleNativePolicy.maxFrameBytes else {
            throw NativeBrokerFault(code: "FRAME_TOO_LARGE", message: "Broker frame exceeds limit.")
        }
        var count = UInt32(data.count).bigEndian
        let prefix = withUnsafeBytes(of: &count) { Data($0) }
        try writeRaw(prefix + data)
    }

    private func readFrame() throws -> Data {
        let header = try readRaw(4)
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length > 0, length <= GoogleNativePolicy.maxFrameBytes else {
            throw NativeBrokerFault(code: "FRAME_INVALID", message: "Invalid broker frame length.")
        }
        return try readRaw(Int(length))
    }

    private func readRaw(_ count: Int) throws -> Data {
        var data = Data(count: count)
        var offset = 0
        while offset < count {
            let n = data.withUnsafeMutableBytes {
                Darwin.recv(fd, $0.baseAddress!.advanced(by: offset), count - offset, 0)
            }
            guard n > 0 else {
                throw NativeBrokerFault(code: "BROKER_CLOSED", message: "Native broker stream ended.")
            }
            offset += n
        }
        return data
    }

    private func writeRaw(_ data: Data) throws {
        try writeLock.withLock {
            guard !stateLock.withLock({ closed }) else { return }
            var offset = 0
            while offset < data.count {
                let n = data.withUnsafeBytes {
                    Darwin.send(fd, $0.baseAddress!.advanced(by: offset), data.count - offset, 0)
                }
                guard n > 0 else {
                    throw NativeBrokerFault(code: "BROKER_CLOSED", message: "Native broker write failed.")
                }
                offset += n
            }
        }
    }
}
