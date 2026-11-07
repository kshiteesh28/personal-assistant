import Foundation
import Darwin

public enum NativeFailure: Error, LocalizedError {
    case invalidLocalURL
    case invalidWakePhrase
    case alreadyRunning
    case unsafeLock

    public var errorDescription: String? {
        switch self {
        case .invalidLocalURL: return "The core URL must use HTTP on 127.0.0.1 or localhost without credentials."
        case .invalidWakePhrase: return "Choose a wake phrase of 2–40 visible characters."
        case .alreadyRunning: return "Another kst instance is already running."
        case .unsafeLock: return "The private kst lock could not be safely acquired."
        }
    }
}

public struct NativeSettings: Codable, Equatable, Sendable {
    public var spokenReplies: Bool

    public init(spokenReplies: Bool = true) {
        self.spokenReplies = spokenReplies
    }

    public func validated() throws -> NativeSettings {
        self
    }
}

public enum WakePhrase {
    public static func validated(_ value: String) throws -> String {
        let phrase = value.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard phrase.count >= 2, phrase.count <= 40, !phrase.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw NativeFailure.invalidWakePhrase
        }
        return phrase
    }
}

public enum LocalEndpoint {
    public static func validated(_ value: String) throws -> URL {
        guard let parts = URLComponents(string: value), parts.scheme == "http",
              ["127.0.0.1", "localhost", "[::1]", "::1"].contains(parts.host ?? ""),
              parts.user == nil, parts.password == nil, parts.query == nil,
              parts.fragment == nil, let url = parts.url else { throw NativeFailure.invalidLocalURL }
        return url
    }
}

/// Advisory singleton ownership; lock files remain in place so their inode stays stable.
public final class InstanceLock {
    private let descriptor: Int32

    public init(directory: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let dirAttributes = try fm.attributesOfItem(atPath: directory.path)
        guard dirAttributes[.type] as? FileAttributeType == .typeDirectory,
              (dirAttributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else { throw NativeFailure.unsafeLock }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let fd = open(directory.appendingPathComponent("native.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw NativeFailure.unsafeLock }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFREG else {
            close(fd); throw NativeFailure.unsafeLock
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw NativeFailure.alreadyRunning }
        descriptor = fd
    }

    deinit { flock(descriptor, LOCK_UN); close(descriptor) }
}

public struct SettingsStore {
    public let url: URL
    public init(url: URL) { self.url = url }

    public func load() throws -> NativeSettings {
        guard FileManager.default.fileExists(atPath: url.path) else { return NativeSettings() }
        return try JSONDecoder().decode(NativeSettings.self, from: Data(contentsOf: url)).validated()
    }

    public func save(_ settings: NativeSettings) throws {
        let settings = try settings.validated()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        // macOS uses the private directory/file permissions below. Explicit data
        // protection attributes can fail on otherwise writable desktop volumes.
        try JSONEncoder().encode(settings).write(to: url, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
