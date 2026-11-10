import Foundation
import AppKit
import CryptoKit
import Security
import KstNativeCore

struct GoogleBrokerBootstrap: Codable, Sendable {
    var schemaVersion = 1
    let socketPath: String
    let capability: String
}
struct GoogleBrokerFault: Error, LocalizedError, Sendable {
    let code: String
    let message: String
    var errorDescription: String? { message }
}
private struct GoogleCredential: Codable, Sendable {
    let accountId: String
    let subject: String
    let email: String
    let generation: Int
    var refreshToken: String
    var grantedScopes: [String]
    let capabilityProfile: GoogleCapabilityProfile?
}
private struct GoogleClient: Decodable, Sendable {
    let client_id: String
    let client_secret: String?
    struct Wrapper: Decodable { let installed: GoogleClient }
}

/// Sole owner of Google secrets. Never logs requests, OAuth URLs, token values or body data.
actor GoogleAccountBroker {
    private let profileURL: URL
    private let keychainService: String
    private var credential: GoogleCredential?
    private var accessToken: String?
    private var accessExpiry = Date.distantPast
    private var accountState = "DISCONNECTED"
    private var pendingGeneration: Int = 0
    private var oauth: GoogleOAuthLoopback?
    private var server: GoogleBrokerSocket?
    private var refreshTask: Task<(String, Date, [String]?), Error>?
    private var refreshGeneration: Int?
    private var authTask: Task<Void, Never>?
    private var lastError: GoogleBrokerFault?
    private let session: URLSession

    init(profileURL: URL) {
        self.profileURL = profileURL
        keychainService = "com.kshiteesh.kst.dev.google." + SHA256.hash(data: Data(profileURL.standardizedFileURL.path.utf8)).map { String(format:"%02x",$0) }.joined()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 30
        configuration.httpCookieStorage = nil; configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: GoogleRedirectRejector(), delegateQueue: nil)
    }
    private func failure(_ code: String, _ message: String) -> GoogleBrokerFault { GoogleBrokerFault(code:code,message:message) }
    func startBroker() throws -> GoogleBrokerBootstrap {
        if let server { return server.bootstrap }
        if let data = try keychainRead("account") {
            credential = try JSONDecoder().decode(GoogleCredential.self, from:data)
            pendingGeneration = credential?.generation ?? 0
            accountState = "CONNECTED"
        }
        let socket = try GoogleBrokerSocket { [weak self] data in
            guard let self else { throw GoogleBrokerFault(code:"BROKER_UNAVAILABLE",message:"Native Google broker stopped.") }
            return try await self.handle(data)
        }
        server = socket
        return socket.bootstrap
    }
    func shutdown() {
        oauth?.cancel(); oauth = nil; authTask?.cancel(); authTask = nil
        refreshTask?.cancel(); refreshTask = nil; refreshGeneration = nil; server?.stop(); server = nil
        accessToken = nil; accessExpiry = .distantPast
    }
    func status() -> [String: Any] {
        var result: [String:Any] = ["status":accountState,"generation":pendingGeneration,"setupRequired":!FileManager.default.fileExists(atPath:profileURL.appendingPathComponent("google-client.json").path)]
        if let lastError { result["error"]=["code":lastError.code,"message":lastError.message] }
        if let credential {
            let selected=credential.capabilityProfile ?? GoogleCapabilityProfile()
            result["capabilityProfile"]=["gmailRead":selected.gmailRead,"gmailCompose":selected.gmailCompose,"gmailModify":selected.gmailModify,"calendarRead":selected.calendarRead,"calendarWrite":selected.calendarWrite]
            result.merge(["accountId":credential.accountId,"email":credential.email,"subject":credential.subject,"grantedScopes":credential.grantedScopes]) { _,new in new }
        } else { result["grantedScopes"] = [String]() }
        return result
    }
    /// Call only after the core has durably reserved this generation and cancelled old proposals.
    func connect(profile: GoogleCapabilityProfile, generation: Int) throws {
        guard accountState != "AUTHORIZING" else { throw failure("AUTH_IN_PROGRESS","Google connection is already in progress.") }
        guard generation > pendingGeneration, generation <= 9007199254740991 else { throw failure("STALE_GENERATION","Reserve a new Google account generation before connecting.") }
        guard (!profile.gmailCompose && !profile.gmailModify) || profile.gmailRead, !profile.calendarWrite || profile.calendarRead else { throw failure("INVALID_INPUT","Write features require read access for their service.") }
        let client = try loadClient()
        let verifier = GoogleNativePolicy.base64URL(try randomData(32)), state = GoogleNativePolicy.base64URL(try randomData(32))
        let challenge = GoogleNativePolicy.base64URL(Data(SHA256.hash(data:Data(verifier.utf8))))
        pendingGeneration = generation; accountState = "AUTHORIZING"; accessToken = nil; lastError = nil
        authTask = Task { [weak self] in
            guard let self else { return }
            do { try await self.authorize(client:client,profile:profile,generation:generation,verifier:verifier,state:state,challenge:challenge) }
            catch { await self.authorizationFailed(generation:generation,error:error) }
        }
    }
    private func authorizationFailed(generation:Int,error:Error) {
        guard pendingGeneration == generation else { return }
        lastError = error as? GoogleBrokerFault ?? failure("GOOGLE_AUTH_FAILED","Google connection failed. Check network access and try again.")
        oauth = nil; authTask = nil; accountState = credential == nil ? "DISCONNECTED" : "REAUTH_REQUIRED"
    }
    private func authorize(client:GoogleClient,profile:GoogleCapabilityProfile,generation:Int,verifier:String,state:String,challenge:String) async throws {
        let listener = try GoogleOAuthLoopback(state:state)
        oauth = listener
        let port = try await listener.ready()
        let redirect = "http://127.0.0.1:\(port)/oauth/callback"
        var url = URLComponents(string:"https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = ["client_id":client.client_id,"redirect_uri":redirect,"response_type":"code","scope":profile.scopes.joined(separator:" "),"access_type":"offline","prompt":"consent select_account","code_challenge_method":"S256","code_challenge":challenge,"state":state].map { URLQueryItem(name:$0.key,value:$0.value) }
        guard let authURL = url.url, await MainActor.run(body:{NSWorkspace.shared.open(authURL)}) else { throw failure("BROWSER_UNAVAILABLE","Could not open Google consent in your browser.") }
        let code = try await listener.authorizationCode()
        let tokens = try await post("https://oauth2.googleapis.com/token", fields:["client_id":client.client_id,"client_secret":client.client_secret ?? "","redirect_uri":redirect,"code_verifier":verifier,"code":code,"grant_type":"authorization_code"])
        guard let token=tokens["access_token"] as? String, let expires=tokens["expires_in"] as? Double else { throw failure("OAUTH_RESPONSE_INVALID","Google returned an incomplete authorization response.") }
        let identity = try await getIdentity(token)
        guard let subject=identity["sub"] as? String,!subject.isEmpty,identity["email_verified"] as? Bool == true,let email=identity["email"] as? String,!email.isEmpty else { throw failure("IDENTITY_INVALID","Google did not return a verified account identity.") }
        let accountId = SHA256.hash(data:Data(("https://accounts.google.com\n"+subject).utf8)).map{String(format:"%02x",$0)}.joined()
        guard generation == pendingGeneration,!Task.isCancelled else { throw failure("STALE_GENERATION","Google account connection was cancelled.") }
        let refresh = (tokens["refresh_token"] as? String) ?? (credential?.accountId == accountId ? credential?.refreshToken : nil)
        guard let refresh,!refresh.isEmpty else { throw failure("REFRESH_TOKEN_MISSING","Google did not grant persistent access. Reconnect with consent.") }
        // Never assume all requested scopes were granted.
        let scopes = (tokens["scope"] as? String)?.split(separator:" ").map(String.init) ?? []
        let record = GoogleCredential(accountId:accountId,subject:subject,email:email,generation:generation,refreshToken:refresh,grantedScopes:scopes,capabilityProfile:profile)
        try keychainWrite("account",data:JSONEncoder().encode(record))
        credential=record; accessToken=token; accessExpiry=Date().addingTimeInterval(expires); accountState="CONNECTED"; oauth=nil; authTask=nil
    }
    /// Core must invalidate admission and durably reserve generation before invoking this method.
    func disconnect(generation:Int) async throws -> Bool {
        guard generation > pendingGeneration, generation <= 9007199254740991 else { throw failure("STALE_GENERATION","Reserve a new account generation before disconnecting.") }
        pendingGeneration=generation; accountState="DISCONNECTING"; lastError=nil
        oauth?.cancel(); oauth=nil; authTask?.cancel(); authTask=nil; refreshTask?.cancel(); refreshTask=nil; refreshGeneration=nil
        let refresh=credential?.refreshToken
        try keychainDelete("account")
        credential=nil; accessToken=nil; accessExpiry = .distantPast
        accountState="DISCONNECTED"
        guard let refresh else { return true }
        do { _ = try await post("https://oauth2.googleapis.com/revoke",fields:["token":refresh]); return true } catch { return false }
    }
    private func loadClient() throws -> GoogleClient {
        let url=profileURL.appendingPathComponent("google-client.json")
        var info=stat()
        guard lstat(url.path,&info)==0,(info.st_mode & S_IFMT)==S_IFREG,info.st_uid==getuid(),info.st_mode & 0o077 == 0,info.st_size<=16384 else { throw failure("GOOGLE_SETUP_REQUIRED","Add an owner-only google-client.json desktop OAuth configuration to the kst core profile.") }
        let client=try JSONDecoder().decode(GoogleClient.Wrapper.self,from:Data(contentsOf:url)).installed
        guard client.client_id.hasSuffix(".apps.googleusercontent.com"),client.client_id.utf8.count<512 else { throw failure("GOOGLE_SETUP_REQUIRED","Google desktop client configuration is invalid.") }
        return client
    }
    private func randomData(_ count:Int) throws -> Data { var data=Data(count:count);let code=data.withUnsafeMutableBytes{SecRandomCopyBytes(kSecRandomDefault,count,$0.baseAddress!)};guard code==errSecSuccess else {throw failure("RANDOM_FAILED","Secure random source is unavailable.")};return data }
    private func keychainRead(_ name:String) throws -> Data? {
        var result:CFTypeRef?
        let code=SecItemCopyMatching([kSecClass:kSecClassGenericPassword,kSecAttrService:keychainService,kSecAttrAccount:name,kSecReturnData:true,kSecMatchLimit:kSecMatchLimitOne] as CFDictionary,&result)
        if code==errSecItemNotFound{return nil};guard code==errSecSuccess,let data=result as? Data else {throw failure("KEYCHAIN_UNAVAILABLE","Unlock the login Keychain to use Google features.")};return data
    }
    private func keychainWrite(_ name:String,data:Data) throws {
        let query=[kSecClass:kSecClassGenericPassword,kSecAttrService:keychainService,kSecAttrAccount:name] as CFDictionary
        let update=SecItemUpdate(query,[kSecValueData:data] as CFDictionary)
        if update==errSecItemNotFound { let code=SecItemAdd([kSecClass:kSecClassGenericPassword,kSecAttrService:keychainService,kSecAttrAccount:name,kSecValueData:data,kSecAttrAccessible:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary,nil);guard code==errSecSuccess else {throw failure("KEYCHAIN_UNAVAILABLE","Google credentials could not be saved in Keychain.")} }
        else if update != errSecSuccess {throw failure("KEYCHAIN_UNAVAILABLE","Google credentials could not be updated in Keychain.")}
    }
    private func keychainDelete(_ name:String) throws {let code=SecItemDelete([kSecClass:kSecClassGenericPassword,kSecAttrService:keychainService,kSecAttrAccount:name] as CFDictionary);guard code==errSecSuccess || code==errSecItemNotFound else {throw failure("KEYCHAIN_UNAVAILABLE","Google credentials could not be removed from Keychain.")}}
    private func key(_ name:String) throws -> SymmetricKey {if let data=try keychainRead(name){return SymmetricKey(data:data)};let data=try randomData(32);try keychainWrite(name,data:data);return SymmetricKey(data:data)}
    private func post(_ endpoint:String,fields:[String:String]) async throws -> [String:Any] {
        var request=URLRequest(url:URL(string:endpoint)!);request.httpMethod="POST";request.setValue("application/x-www-form-urlencoded",forHTTPHeaderField:"Content-Type")
        var body=URLComponents();body.queryItems=fields.filter{!$0.value.isEmpty}.map{URLQueryItem(name:$0.key,value:$0.value)};request.httpBody=Data((body.percentEncodedQuery ?? "").replacingOccurrences(of:"+",with:"%2B").utf8)
        let (data,response)=try await limitedResponse(request)
        guard data.count<=65536,let http=response as? HTTPURLResponse else{throw failure("GOOGLE_RESPONSE_INVALID","Google returned an invalid response.")}
        if endpoint=="https://oauth2.googleapis.com/token",http.statusCode==400,(try? JSONSerialization.jsonObject(with:data) as? [String:Any])?["error"] as? String == "invalid_grant" {throw failure("REAUTH_REQUIRED","Google access expired or was revoked. Reconnect your account.")}
        guard (200..<300).contains(http.statusCode) else {throw failure("GOOGLE_AUTH_FAILED","Google authorization request failed. Reconnect or check network access.")}
        return data.isEmpty ? [:] : (try JSONSerialization.jsonObject(with:data) as? [String:Any] ?? [:])
    }
    private func limitedResponse(_ request:URLRequest) async throws -> (Data,URLResponse) {
        let (stream,response)=try await session.bytes(for:request)
        guard response.expectedContentLength <= 65536 else {throw failure("GOOGLE_RESPONSE_INVALID","Google authorization response exceeded the limit.")}
        var data=Data();for try await byte in stream {guard data.count<65536 else{throw failure("GOOGLE_RESPONSE_INVALID","Google authorization response exceeded the limit.")};data.append(byte)}
        return(data,response)
    }
    private func getIdentity(_ token:String) async throws -> [String:Any] {var request=URLRequest(url:URL(string:"https://openidconnect.googleapis.com/v1/userinfo")!);request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization");let (data,response)=try await limitedResponse(request);guard data.count<=65536,(response as? HTTPURLResponse)?.statusCode==200,let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else {throw failure("IDENTITY_INVALID","Could not verify the Google account.")};return value}
    private func current(_ params:[String:Any]) throws -> GoogleCredential {guard let record=credential,accountState=="CONNECTED",params["accountId"] as? String==record.accountId,exactInt(params["accountGeneration"])==record.generation,pendingGeneration==record.generation else{throw failure("STALE_GENERATION","Google account changed or requires reconnection.")};return record}
    private func token(_ params:[String:Any]) async throws -> [String:Any] {
        let record=try current(params)
        let selected=record.capabilityProfile ?? GoogleCapabilityProfile()
        if params["service"] as? String == "gmail", !selected.gmailRead { throw failure("SCOPE_NOT_GRANTED","Gmail is disabled in the selected connection profile.") }
        if params["service"] as? String == "calendar", !selected.calendarRead { throw failure("SCOPE_NOT_GRANTED","Calendar is disabled in the selected connection profile.") }
        if params["forceRefresh"] as? Bool == true { accessToken=nil;accessExpiry = .distantPast }
        guard let service=params["service"] as? String,["gmail","calendar"].contains(service),record.grantedScopes.contains(where:{$0.contains("/auth/"+service+".")}) else {throw failure("SCOPE_NOT_GRANTED","This Google service permission was not granted.")}
        if let accessToken,accessExpiry.timeIntervalSinceNow>60{return ["accessToken":accessToken,"expiresAt":Int(accessExpiry.timeIntervalSince1970*1000),"grantedScopes":record.grantedScopes]}
        let task:Task<(String,Date,[String]?),Error>
        if let refreshTask,refreshGeneration==record.generation {task=refreshTask} else {
            let client=try loadClient()
            task=Task {let value=try await self.post("https://oauth2.googleapis.com/token",fields:["client_id":client.client_id,"client_secret":client.client_secret ?? "","refresh_token":record.refreshToken,"grant_type":"refresh_token"]);guard let token=value["access_token"] as? String,let expires=value["expires_in"] as? Double else{throw self.failure("GOOGLE_RESPONSE_INVALID","Google refresh returned an invalid response.")};return(token,Date().addingTimeInterval(expires),(value["scope"] as? String)?.split(separator:" ").map(String.init))};refreshTask=task;refreshGeneration=record.generation
        }
        do {let result=try await task.value;if refreshGeneration==record.generation{refreshTask=nil;refreshGeneration=nil};_ = try current(params);accessToken=result.0;accessExpiry=result.1;if let scopes=result.2{credential?.grantedScopes=scopes;if let credential{try keychainWrite("account",data:JSONEncoder().encode(credential))}};return ["accessToken":result.0,"expiresAt":Int(result.1.timeIntervalSince1970*1000),"grantedScopes":credential?.grantedScopes ?? []]} catch {if refreshGeneration==record.generation{refreshTask=nil;refreshGeneration=nil};if (error as? GoogleBrokerFault)?.code=="REAUTH_REQUIRED",pendingGeneration==record.generation{accountState="REAUTH_REQUIRED"};throw error}
    }
    func handle(_ data:Data) async throws -> Data {
        guard data.count<=GoogleNativePolicy.maxFrameBytes,GoogleStrictJSON.valid(data) else {throw failure("BROKER_REJECTED","Invalid native broker JSON.")}
        let object=try JSONSerialization.jsonObject(with:data)
        guard let frame=object as? [String:Any],Set(frame.keys)==Set(["schemaVersion","id","capability","method","params"]),exactInt(frame["schemaVersion"])==1,let id=frame["id"] as? String,!id.isEmpty,id.utf8.count<=128,let capability=frame["capability"] as? String,let server,GoogleNativePolicy.constantTimeEqual(capability,server.bootstrap.capability),let method=frame["method"] as? String,let params=frame["params"] as? [String:Any] else {throw failure("BROKER_REJECTED","Invalid native broker request.")}
        do {
            let result:[String:Any]
            switch method {
            case "account.connect":
                try fields(params,["capabilityProfile","generation"])
                guard let profile=params["capabilityProfile"] as? [String:Any],Set(profile.keys)==Set(["gmailRead","gmailCompose","gmailModify","calendarRead","calendarWrite"]),profile.values.allSatisfy({($0 as? NSNumber)?.isBoolean == true}),let generation=exactInt(params["generation"]) else{throw failure("INVALID_INPUT","Invalid connection profile.")}
                let parsed=try JSONDecoder().decode(GoogleCapabilityProfile.self,from:JSONSerialization.data(withJSONObject:profile))
                try connect(profile:parsed,generation:generation);result=status()
            case "account.disconnect":
                try fields(params,["generation"]);guard let generation=exactInt(params["generation"]) else{throw failure("INVALID_INPUT","Invalid disconnect generation.")};let revoked=try await disconnect(generation:generation);var value=status();value["remoteRevoked"]=revoked;result=value
            case "account.status": guard params.isEmpty else{throw failure("INVALID_INPUT","Unexpected status fields.")};result=status()
            case "token.get": guard Set(params.keys)==Set(["accountId","accountGeneration","service"]) || Set(params.keys)==Set(["accountId","accountGeneration","service","forceRefresh"]) else{throw failure("INVALID_INPUT","Unexpected token fields.")};if let force=params["forceRefresh"]{guard (force as? NSNumber)?.isBoolean==true else{throw failure("INVALID_INPUT","Invalid forceRefresh flag.")}};result=try await token(params)
            case "input.digest": try fields(params,["path","canonicalRequest"]);guard let path=params["path"] as? String,let canonical=params["canonicalRequest"] as? String,path.utf8.count<=256,canonical.utf8.count<=65536 else{throw failure("INVALID_INPUT","Invalid digest input.")};result=["digest":HMAC<SHA256>.authenticationCode(for:Data((path+"\n"+canonical).utf8),using:try key("input-digest")).map{String(format:"%02x",$0)}.joined()]
            case "envelope.seal","envelope.open":
                let valueKey=method=="envelope.seal" ? "plaintext":"ciphertext"
                try fields(params,["operationId","accountId","accountGeneration","schemaVersion",valueKey]);_ = try current(params)
                guard exactInt(params["schemaVersion"])==1,let operation=params["operationId"] as? String,operation.utf8.count<=128,let value=params[valueKey] as? String,let payload=Data(base64Encoded:value),payload.count<=256*1024 else{throw failure("INVALID_INPUT","Invalid encrypted envelope input.")}
                let metadata=params.filter{$0.key != valueKey},aad=try JSONSerialization.data(withJSONObject:metadata,options:[.sortedKeys])
                if method=="envelope.seal" {let sealed=try AES.GCM.seal(payload,using:key("envelopes"),authenticating:aad);result=["ciphertext":sealed.combined!.base64EncodedString()]}
                else {let plaintext=try AES.GCM.open(AES.GCM.SealedBox(combined:payload),using:key("envelopes"),authenticating:aad);result=["plaintext":plaintext.base64EncodedString()]}
            default: throw failure("BROKER_METHOD_REJECTED","This native broker method is unsupported.")
            }
            return try JSONSerialization.data(withJSONObject:["id":id,"result":result],options:[.sortedKeys])
        } catch {let fault=error as? GoogleBrokerFault ?? failure("BROKER_FAILED","Native Google operation failed.");return try JSONSerialization.data(withJSONObject:["id":id,"error":["code":fault.code,"message":fault.message]])}
    }
    private func exactInt(_ value:Any?) -> Int? { guard let number=value as? NSNumber,!number.isBoolean,let value=value as? Int,value>=0,value<=9007199254740991,number.doubleValue==Double(value) else{return nil};return value }
    private func fields(_ params:[String:Any],_ keys:[String]) throws {guard Set(params.keys)==Set(keys) else{throw failure("INVALID_INPUT","Native broker parameters do not match the method schema.")}}
}

private final class GoogleRedirectRejector:NSObject,URLSessionTaskDelegate,@unchecked Sendable {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping @Sendable(URLRequest?)->Void){completionHandler(nil)}
}

private extension NSNumber { var isBoolean:Bool { CFGetTypeID(self)==CFBooleanGetTypeID() } }
