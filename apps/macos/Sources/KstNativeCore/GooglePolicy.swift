import Foundation

public struct GoogleCapabilityProfile: Codable, Sendable, Equatable {
    public let gmailRead: Bool
    public let gmailCompose: Bool
    public let gmailModify: Bool
    public let calendarRead: Bool
    public let calendarWrite: Bool
    public init(gmailRead: Bool = true, gmailCompose: Bool = false, gmailModify: Bool = false, calendarRead: Bool = true, calendarWrite: Bool = false) {
        self.gmailRead = gmailRead; self.gmailCompose = gmailCompose; self.gmailModify = gmailModify; self.calendarRead = calendarRead; self.calendarWrite = calendarWrite
    }
    public var scopes: [String] {
        let prefix = "https://www.googleapis.com/auth/"
        var result = ["openid", "email"]
        if gmailModify { result += [prefix + "gmail.modify"] }
        else { if gmailRead || gmailCompose { result += [prefix + "gmail.readonly"] }; if gmailCompose { result += [prefix + "gmail.compose"] } }
        if calendarRead || calendarWrite { result += [prefix + "calendar.calendarlist.readonly", prefix + "calendar.events.readonly", prefix + "calendar.events.freebusy"] }
        if calendarWrite { result += [prefix + "calendar.events.owned"] }
        return result.sorted()
    }
}

public enum GoogleNativePolicy {
    public static let maxFrameBytes = 512 * 1024
    public static func base64URL(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    public static func constantTimeEqual(_ lhs: String, _ rhs: String) -> Bool {
        let a = Array(lhs.utf8), b = Array(rhs.utf8)
        guard a.count == b.count else { return false }
        return zip(a,b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
    public static func callback(_ request: String, port: UInt16, state: String) -> String? {
        let lines = request.components(separatedBy: "\r\n")
        guard let first = lines.first else { return nil }
        let words = first.split(separator: " ")
        guard words.count == 3, words[0] == "GET", words[2] == "HTTP/1.1",
              let url = URLComponents(string: String(words[1])), url.scheme == nil, url.host == nil, url.path == "/oauth/callback" else { return nil }
        let hosts = lines.dropFirst().filter { $0.lowercased().hasPrefix("host:") }.map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }
        guard hosts == ["127.0.0.1:\(port)"] else { return nil }
        let items = url.queryItems ?? []
        guard items.filter({$0.name == "state"}).count == 1,
              constantTimeEqual(items.first(where: {$0.name == "state"})?.value ?? "", state),
              items.filter({$0.name == "code"}).count + items.filter({$0.name == "error"}).count == 1 else { return nil }
        if let error = items.first(where: {$0.name == "error"})?.value { return "error:" + error }
        guard let code = items.first(where: {$0.name == "code"})?.value, !code.isEmpty, code.utf8.count <= 4096 else { return nil }
        return code
    }
}

/// Reject duplicate object keys before Foundation's permissive JSON decoder sees a frame.
public enum GoogleStrictJSON {
    public static func valid(_ data:Data)->Bool {
        var parser=Scanner(bytes:Array(data))
        do{try parser.value(depth:0);parser.space();return parser.index==parser.bytes.count}catch{return false}
    }
    private struct Scanner {
        let bytes:[UInt8];var index=0
        enum Invalid:Error{case json}
        mutating func space(){while index<bytes.count,[UInt8(9),10,13,32].contains(bytes[index]){index+=1}}
        mutating func string()throws->String{
            space();let start=index;guard index<bytes.count,bytes[index]==34 else{throw Invalid.json};index+=1
            while index<bytes.count{
                let b=bytes[index];index+=1
                if b==92{guard index<bytes.count else{throw Invalid.json};index+=1;continue}
                if b==34{let raw=Data(bytes[start..<index]);guard let text=try JSONSerialization.jsonObject(with:raw,options:.fragmentsAllowed) as? String else{throw Invalid.json};return text}
                if b<32{throw Invalid.json}
            };throw Invalid.json
        }
        mutating func value(depth:Int)throws{
            guard depth<=32 else{throw Invalid.json};space();guard index<bytes.count else{throw Invalid.json}
            switch bytes[index]{
            case 34:_ = try string()
            case 123:
                index+=1;space();if index<bytes.count,bytes[index]==125{index+=1;return};var keys=Set<String>()
                while true{let key=try string();guard keys.insert(key).inserted else{throw Invalid.json};space();guard index<bytes.count,bytes[index]==58 else{throw Invalid.json};index+=1;try value(depth:depth+1);space();guard index<bytes.count else{throw Invalid.json};let end=bytes[index];index+=1;if end==125{return};guard end==44 else{throw Invalid.json}}
            case 91:
                index+=1;space();if index<bytes.count,bytes[index]==93{index+=1;return};while true{try value(depth:depth+1);space();guard index<bytes.count else{throw Invalid.json};let end=bytes[index];index+=1;if end==93{return};guard end==44 else{throw Invalid.json}}
            default:
                let start=index;while index<bytes.count,![UInt8(9),10,13,32,44,93,125].contains(bytes[index]){index+=1}
                guard index>start else{throw Invalid.json};_ = try JSONSerialization.jsonObject(with:Data(bytes[start..<index]),options:.fragmentsAllowed)
            }
        }
    }
}
