import Foundation
import KstNativeCore

func testGoogleNativePolicy() throws {
    let prefix="https://www.googleapis.com/auth/"
    let defaults=GoogleCapabilityProfile().scopes
    try check(defaults.contains(prefix+"gmail.readonly"),"Google defaults request mail reads")
    try check(defaults.contains(prefix+"calendar.events.freebusy"),"Google defaults include exact availability scope")
    try check(!defaults.contains(prefix+"gmail.compose"),"Google writes never requested by default")
    let modify=GoogleCapabilityProfile(gmailCompose:true,gmailModify:true).scopes
    try check(modify.contains(prefix+"gmail.modify") && !modify.contains(prefix+"gmail.compose") && !modify.contains(prefix+"gmail.readonly"),"Modify eliminates redundant Gmail scopes")
    try check(GoogleNativePolicy.base64URL(Data([251,255]))=="-_8","Unpadded PKCE base64 URL")
    try check(GoogleNativePolicy.constantTimeEqual("secret","secret"),"Matching broker capability")
    try check(!GoogleNativePolicy.constantTimeEqual("secret","secreu"),"Capability mismatch")
    try check(!GoogleNativePolicy.constantTimeEqual("secret","secret0"),"Capability length mismatch")
    func request(_ query:String,host:String="127.0.0.1:1234",verb:String="GET",path:String="/oauth/callback")->String {"\(verb) \(path)?\(query) HTTP/1.1\r\nHost: \(host)\r\n\r\n"}
    try check(GoogleNativePolicy.callback(request("state=expected&code=ok"),port:1234,state:"expected")=="ok","Valid OAuth loopback callback")
    try check(GoogleNativePolicy.callback(request("state=wrong&code=ok"),port:1234,state:"expected")==nil,"Wrong state rejected without authorization")
    try check(GoogleNativePolicy.callback(request("state=expected&state=expected&code=ok"),port:1234,state:"expected")==nil,"Repeated state rejected")
    try check(GoogleNativePolicy.callback(request("state=expected&code=ok&code=again"),port:1234,state:"expected")==nil,"Repeated code rejected")
    try check(GoogleNativePolicy.callback(request("state=expected&code=ok",host:"evil.test:1234"),port:1234,state:"expected")==nil,"Host header attack rejected")
    try check(GoogleNativePolicy.callback(request("state=expected&code=ok",verb:"POST"),port:1234,state:"expected")==nil,"POST callback rejected")
    try check(GoogleNativePolicy.callback(request("state=expected&code=ok",path:"/wrong"),port:1234,state:"expected")==nil,"Callback path exact")
    try check(GoogleNativePolicy.callback(request("state=expected&error=access_denied"),port:1234,state:"expected")=="error:access_denied","Provider denial is explicit")
    for value in ["{}","[]","{\"object\":{\"key\":1},\"array\":[true,null,\"text\"]}"] {try check(GoogleStrictJSON.valid(Data(value.utf8)),"Valid strict JSON accepted")}
    for value in ["{\"x\":1,\"x\":2}","{\"x\":1,\"\\u0078\":2}","{\"outer\":{\"x\":1,\"x\":2}}","{\"x\":1,}","[1,]","{}[]","{\"x\":NaN}",String(repeating:"[",count:34)+"0"+String(repeating:"]",count:34)] {try check(!GoogleStrictJSON.valid(Data(value.utf8)),"Duplicate/malformed/deep JSON rejected")}
    print("Google native policy checks passed: scopes, PKCE encoding, capability comparison, callback authority/state, strict JSON/depth.")
}
