import Foundation
import Darwin
import Security
import KstNativeCore

/// Dedicated owner-only Unix socket. It does not expose a general HTTP or Keychain proxy.
final class GoogleBrokerSocket: @unchecked Sendable {
    let bootstrap: GoogleBrokerBootstrap
    private let directory: String
    private let descriptor: Int32
    private let lock=NSLock()
    private var stopped=false
    private var clients=0
    private let handler:@Sendable(Data) async throws ->Data
    init(handler:@escaping @Sendable(Data) async throws ->Data) throws {
        self.handler=handler
        var random=Data(count:32)
        guard random.withUnsafeMutableBytes({SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!)})==errSecSuccess else{throw GoogleBrokerFault(code:"RANDOM_FAILED",message:"Secure random source unavailable.")}
        directory="/private/tmp/kst-\(getuid())-"+UUID().uuidString.replacingOccurrences(of:"-",with:"")
        let path=directory+"/b.sock"
        guard path.utf8.count<104 else{throw GoogleBrokerFault(code:"BROKER_PATH_INVALID",message:"Native broker socket path is too long.")}
        guard mkdir(directory,0o700)==0 else{throw GoogleBrokerFault(code:"BROKER_UNAVAILABLE",message:"Could not create private broker directory.")}
        var info=stat()
        guard lstat(directory,&info)==0,info.st_uid==getuid(),info.st_mode&S_IFMT==S_IFDIR,info.st_mode&0o777==0o700 else{throw GoogleBrokerFault(code:"BROKER_UNAVAILABLE",message:"Broker directory ownership is invalid.")}
        descriptor=socket(AF_UNIX,SOCK_STREAM,0)
        guard descriptor>=0 else{rmdir(directory);throw GoogleBrokerFault(code:"BROKER_UNAVAILABLE",message:"Could not create native broker socket.")}
        var address=sockaddr_un();address.sun_family=sa_family_t(AF_UNIX);address.sun_len=UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of:&address.sun_path){buffer in buffer.initializeMemory(as:UInt8.self,repeating:0);buffer.copyBytes(from:Array(path.utf8)+[0])}
        let socketDescriptor=descriptor
        let bound=withUnsafePointer(to:&address){$0.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.bind(socketDescriptor,$0,socklen_t(MemoryLayout<sockaddr_un>.size))}}
        guard bound==0,chmod(path,0o600)==0,listen(descriptor,8)==0 else{Darwin.close(descriptor);unlink(path);rmdir(directory);throw GoogleBrokerFault(code:"BROKER_UNAVAILABLE",message:"Could not bind native broker socket.")}
        bootstrap=GoogleBrokerBootstrap(socketPath:path,capability:random.base64EncodedString())
        DispatchQueue.global(qos:.utility).async{[weak self] in self?.acceptLoop()}
    }
    func stop(){lock.lock();let first = !stopped;stopped=true;lock.unlock();if first{Darwin.shutdown(descriptor,SHUT_RDWR);unlink(bootstrap.socketPath);rmdir(directory)}}
    deinit{stop()}
    private func acceptLoop(){defer{Darwin.close(descriptor)};while true{
        if lock.withLock({stopped}){return}
        let peer=Darwin.accept(descriptor,nil,nil)
        if peer<0{return}
        var uid=uid_t(),gid=gid_t()
        lock.lock();let allow = !stopped && clients<8 && getpeereid(peer,&uid,&gid)==0 && uid==getuid();if allow{clients+=1};lock.unlock()
        guard allow else{Darwin.close(peer);continue}
        let connection=GoogleBrokerConnection(peer)
        DispatchQueue.global().asyncAfter(deadline:.now()+5){connection.cancel()}
        DispatchQueue.global(qos:.utility).async{[weak self] in
            guard let self else{connection.finish();return}
            do{
                let length=try connection.read(4).reduce(UInt32(0)){($0<<8)|UInt32($1)}
                guard length>0,length<=GoogleNativePolicy.maxFrameBytes else{throw GoogleBrokerFault(code:"FRAME_INVALID",message:"Invalid frame length.")}
                let input=try connection.read(Int(length))
                Task{
                    defer{connection.finish();self.lock.withLock{self.clients-=1}}
                    guard let response=try? await self.handler(input),response.count<=GoogleNativePolicy.maxFrameBytes else{return}
                    var count=UInt32(response.count).bigEndian
                    let prefix=withUnsafeBytes(of:&count){Data($0)}
                    try? connection.write(prefix+response)
                }
            }catch{connection.finish();self.lock.withLock{self.clients-=1}}
        }
    }}
}
private final class GoogleBrokerConnection:@unchecked Sendable{
    private let fd:Int32
    private let lock=NSLock()
    private var closed=false
    init(_ fd:Int32){self.fd=fd;var seconds=timeval(tv_sec:5,tv_usec:0);withUnsafePointer(to:&seconds){_ = setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,$0,socklen_t(MemoryLayout<timeval>.size));_ = setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,$0,socklen_t(MemoryLayout<timeval>.size))};var yes:Int32=1;_ = setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&yes,socklen_t(MemoryLayout<Int32>.size))}
    func cancel(){lock.withLock{if !closed{Darwin.shutdown(fd,SHUT_RDWR)}}}
    func finish(){lock.withLock{if !closed{closed=true;Darwin.shutdown(fd,SHUT_RDWR);Darwin.close(fd)}}}
    func read(_ count:Int)throws->Data{var data=Data(count:count);var offset=0;while offset<count{let n=data.withUnsafeMutableBytes{Darwin.recv(fd,$0.baseAddress!.advanced(by:offset),count-offset,0)};guard n>0 else{throw GoogleBrokerFault(code:"BROKER_CLOSED",message:"Native broker request ended.")};offset+=n};return data}
    func write(_ data:Data)throws{try lock.withLock{guard !closed else{return};var offset=0;while offset<data.count{let n=data.withUnsafeBytes{Darwin.send(fd,$0.baseAddress!.advanced(by:offset),data.count-offset,0)};guard n>0 else{throw GoogleBrokerFault(code:"BROKER_CLOSED",message:"Native broker response ended.")};offset+=n}}}
}
