import Foundation
import Network
import KstNativeCore

final class GoogleOAuthLoopback:@unchecked Sendable{
    private let listener:NWListener
    private let state:String
    private let queue=DispatchQueue(label:"kst.google.oauth")
    private let lock=NSLock()
    private var readyWaiter:CheckedContinuation<UInt16,Error>?
    private var codeWaiter:CheckedContinuation<String,Error>?
    private var port:UInt16?
    private var result:Result<String,Error>?
    private var stopped=false
    init(state:String)throws{
        self.state=state
        let parameters=NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
        listener=try NWListener(using:parameters)
        listener.stateUpdateHandler={[weak self] state in guard let self else{return};switch state{case .ready:if let port=self.listener.port?.rawValue{self.ready(port)};case .failed:self.complete(.failure(GoogleBrokerFault(code:"OAUTH_CALLBACK_FAILED",message:"Google callback listener failed.")));default:break}}
        listener.newConnectionHandler={[weak self] connection in self?.receive(connection)}
        listener.start(queue:queue)
        queue.asyncAfter(deadline:.now()+300){[weak self] in self?.complete(.failure(GoogleBrokerFault(code:"AUTH_EXPIRED",message:"Google connection expired. Start again.")))}
    }
    func ready()async throws->UInt16{try await withCheckedThrowingContinuation{continuation in lock.lock();if let port{lock.unlock();continuation.resume(returning:port)}else if stopped{lock.unlock();continuation.resume(throwing:GoogleBrokerFault(code:"AUTH_CANCELLED",message:"Google connection cancelled."))}else{readyWaiter=continuation;lock.unlock()}}}
    func authorizationCode()async throws->String{try await withCheckedThrowingContinuation{continuation in lock.lock();if let result{lock.unlock();continuation.resume(with:result)}else{codeWaiter=continuation;lock.unlock()}}}
    func cancel(){complete(.failure(GoogleBrokerFault(code:"AUTH_CANCELLED",message:"Google connection cancelled.")))}
    private func ready(_ value:UInt16){lock.lock();guard !stopped else{lock.unlock();return};port=value;let waiter=readyWaiter;readyWaiter=nil;lock.unlock();waiter?.resume(returning:value)}
    private func complete(_ value:Result<String,Error>){lock.lock();guard !stopped else{lock.unlock();return};stopped=true;result=value;let code=codeWaiter;codeWaiter=nil;let ready=readyWaiter;readyWaiter=nil;lock.unlock();listener.cancel();code?.resume(with:value);ready?.resume(throwing:GoogleBrokerFault(code:"AUTH_CANCELLED",message:"Google connection ended."))}
    private func receive(_ connection:NWConnection){connection.start(queue:queue);read(connection,buffer:Data())}
    private func read(_ connection:NWConnection,buffer:Data){connection.receive(minimumIncompleteLength:1,maximumLength:16384){[weak self] data,_,complete,error in
        guard let self else{connection.cancel();return}
        let bytes=buffer+(data ?? Data())
        guard bytes.count<=16384,error==nil else{connection.cancel();return}
        if bytes.range(of:Data("\r\n\r\n".utf8)) != nil{
            let code=String(data:bytes,encoding:.utf8).flatMap{request in self.lock.withLock{self.stopped ? nil:self.port.flatMap{GoogleNativePolicy.callback(request,port:$0,state:self.state)}}}
            let valid=code != nil
            let body=valid ? "Google response received. You can return to kst.":"Invalid callback. Return to kst and try again."
            let response="HTTP/1.1 \(valid ? "200 OK":"400 Bad Request")\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
            connection.send(content:Data(response.utf8),completion:.contentProcessed{_ in connection.cancel()})
            if let code{self.complete(code.hasPrefix("error:") ? .failure(GoogleBrokerFault(code:"AUTH_DENIED",message:"Google account connection was declined.")):.success(code))}
        }else if !complete{self.read(connection,buffer:bytes)}else{connection.cancel()}
    }}
}
