import Foundation
import React
import RiviumSync
import Combine

@objc(RiviumSync)
class RiviumSyncModule: RCTEventEmitter {

    @objc static var shared: RiviumSyncModule?

    private var listeners: [String: ListenerRegistration] = [:]
    private var delegateHandler: RiviumSyncDelegateHandler?
    private var rejectedWrites: RejectedWritesListener?

    // Cache connection state to emit when JS listener is added (matching Android behavior)
    private var lastConnectionState: Bool?
    private var hasListeners = false

    override init() {
        super.init()
        RiviumSyncModule.shared = self
    }

    override var bridge: RCTBridge! {
        didSet {
            RiviumSyncModule.shared = self
        }
    }

    func handleConnected() {
        lastConnectionState = true
        if hasListeners { sendEvent(withName: "onConnectionState", body: true) }
    }

    func handleDisconnected() {
        lastConnectionState = false
        if hasListeners { sendEvent(withName: "onConnectionState", body: false) }
    }

    func handleConnectionFailed(_ error: Error) {
        if hasListeners {
            sendEvent(withName: "onError", body: [
                "code": "connectionError",
                "message": error.localizedDescription
            ])
        }
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func supportedEvents() -> [String]! {
        return ["onConnectionState", "onError", "collectionUpdate", "documentUpdate", "queryUpdate", "onSyncState", "onPendingCount", "onAwaitingUserToken", "onDocumentRejected"]
    }

    // Called when JS starts listening - emit cached state
    override func startObserving() {
        hasListeners = true
        // Emit cached connection state when JS listener is added
        if let state = lastConnectionState {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.sendEvent(withName: "onConnectionState", body: state)
            }
        }
    }

    override func stopObserving() {
        hasListeners = false
    }

    private var syncStateCancellable: Any?
    private var pendingCountCancellable: Any?
    
    @objc func `init`(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let apiKey = options["apiKey"] as? String else {
            reject("ERROR", "apiKey required", nil)
            return
        }

        // Parse conflict strategy
        var conflictStrategy: ConflictStrategy = .serverWins
        if let strategyString = options["conflictStrategy"] as? String {
            switch strategyString {
            case "clientWins": conflictStrategy = .clientWins
            case "merge": conflictStrategy = .merge
            case "manual": conflictStrategy = .manual
            default: conflictStrategy = .serverWins
            }
        }

        let configBuilder = RiviumSyncConfigBuilder(apiKey: apiKey)
        if let userId = options["userId"] as? String {
            _ = configBuilder.userId(userId)
        }

        // Signed user token, minted by the app's own backend.
        if let userToken = options["userToken"] as? String {
            _ = configBuilder.userToken(userToken)
        }
        // Endpoints are fixed in the native SDK and always encrypted; there is nothing to pass.
        _ = configBuilder.debugMode(options["debugMode"] as? Bool ?? false)
        _ = configBuilder.autoReconnect(options["autoReconnect"] as? Bool ?? true)

        // Offline persistence options
        _ = configBuilder.offlineEnabled(options["offlineEnabled"] as? Bool ?? false)
        _ = configBuilder.offlineCacheSizeMb(options["offlineCacheSizeMb"] as? Int ?? 100)
        _ = configBuilder.syncOnReconnect(options["syncOnReconnect"] as? Bool ?? true)
        _ = configBuilder.conflictStrategy(conflictStrategy)
        // A local Rivium Sync server (JS `emulator`): plain HTTP and realtime without TLS. Checked here too, as
        // the native builder stops the app on a bad host or port.
        if let host = options["emulatorHost"] as? String {
            let trimmed = host.trimmingCharacters(in: .whitespaces)
            let port = options["emulatorPort"] as? Int ?? 3006
            guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains(":"), (1...65535).contains(port) else {
                reject("ERROR", "emulator host is a host name or IP address, without scheme or port; port 1-65535", nil)
                return
            }
            _ = configBuilder.useEmulator(host: trimmed, port: port)
        }
        // Report this package (react-native/<version>) in the X-Rivium-SDK header.
        _ = configBuilder.wrapperSdk(
            name: options["wrapperSdkName"] as? String,
            version: options["wrapperSdkVersion"] as? String
        )

        let config = configBuilder.build()
        RiviumSync.initialize(config: config)
        delegateHandler = RiviumSyncDelegateHandler(module: self)
        RiviumSync.shared?.delegate = delegateHandler
        // The project requires a user token and none is set yet: connect() is
        // parked, not failed. The SDK connects when setUserToken supplies one.
        RiviumSync.shared?.onAwaitingUserToken = { [weak self] in
            DispatchQueue.main.async {
                guard let self = self, self.hasListeners else { return }
                self.sendEvent(withName: "onAwaitingUserToken", body: nil)
            }
        }

        // Set up offline listeners if enabled
        if options["offlineEnabled"] as? Bool == true {
            setupOfflineListeners()
            // Queued writes the server refused: JS onDocumentRejected.
            let listener = RejectedWritesListener(module: self)
            rejectedWrites = listener
            RiviumSync.shared?.addSyncListener(listener)
        }

        resolve(nil)
    }

    func handleDocumentRejected(documentId: String, operation: OperationType, error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.hasListeners else { return }
            self.sendEvent(withName: "onDocumentRejected", body: [
                "documentId": documentId,
                "operation": operation.rawValue,
                "error": RiviumSyncModule.listenerErrorMap(error)
            ])
        }
    }

    /// Rejects with `code` and the error's message; when the server answered, its HTTP status is in the
    /// rejection's userInfo (`statusCode`), which JS turns into a RiviumSyncError.
    /// A query the rules do not allow (also `getAll()`) is rejected as `query_not_allowed` with its fields.
    private static func rejectWith(_ reject: RCTPromiseRejectBlock, _ code: String, _ error: Error) {
        if case RiviumSyncError.queryNotAllowed(let message, let fields) = error {
            let nsError = NSError(domain: "RiviumSync", code: 403, userInfo: [
                NSLocalizedDescriptionKey: message,
                "fields": fields,
                "statusCode": 403
            ])
            reject("query_not_allowed", message, nsError)
            return
        }
        guard let status = (error as? RiviumSyncError)?.statusCode else {
            reject(code, error.localizedDescription, error)
            return
        }
        let nsError = NSError(domain: "RiviumSync", code: status, userInfo: [
            NSLocalizedDescriptionKey: error.localizedDescription,
            "statusCode": status
        ])
        reject(code, error.localizedDescription, nsError)
    }

    private func setupOfflineListeners() {
        // Listen to sync state changes
        if #available(iOS 13.0, *) {
            syncStateCancellable = RiviumSync.shared?.syncStatePublisher?
                .receive(on: DispatchQueue.main)
                .sink { [weak self] state in
                    let stateString: String
                    switch state {
                    case .idle: stateString = "idle"
                    case .syncing: stateString = "syncing"
                    case .offline: stateString = "offline"
                    case .error: stateString = "error"
                    }
                    if self?.hasListeners == true {
                        self?.sendEvent(withName: "onSyncState", body: stateString)
                    }
                }

            pendingCountCancellable = RiviumSync.shared?.pendingCountPublisher?
                .receive(on: DispatchQueue.main)
                .sink { [weak self] count in
                    if self?.hasListeners == true {
                        self?.sendEvent(withName: "onPendingCount", body: count)
                    }
                }
        }
    }
    
    /// Replace the signed user token. JS fetches it from the app's own backend
    /// and pushes it down, which keeps the bridge one-way.
    @objc func setUserToken(_ token: String?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sync = RiviumSync.shared else {
            reject("notInitialized", "Call init before setUserToken", nil)
            return
        }
        sync.userTokens.set(token)
        resolve(nil)
    }

    @objc func connect(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let sdk = RiviumSync.shared else {
            reject("NOT_INITIALIZED", "RiviumSync not initialized. Call init() first.", nil)
            return
        }
        sdk.connect { result in
            switch result {
            case .success:
                resolve(nil)
            case .failure(let error):
                reject("CONNECTION_ERROR", error.localizedDescription, error)
            }
        }
    }
    
    @objc func disconnect(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        RiviumSync.shared?.disconnect()
        resolve(nil)
    }
    
    @objc func isConnected(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(RiviumSync.shared?.isConnected ?? false)
    }

    @objc func isAwaitingUserToken(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(RiviumSync.shared?.isAwaitingUserToken ?? false)
    }
    
    @objc func listDatabases(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let databases = try await RiviumSync.shared?.listDatabases() ?? []
                let result = databases.map { db in
                    return [
                        "id": db.id,
                        "name": db.name,
                        "createdAt": db.createdAt,
                        "updatedAt": db.updatedAt
                    ]
                }
                resolve(result)
            } catch {
                RiviumSyncModule.rejectWith(reject, "DATABASE_ERROR", error)
            }
        }
    }
    
    @objc func createDatabase(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let name = options["name"] as? String else {
            reject("ERROR", "name required", nil)
            return
        }
        
        Task {
            do {
                let db = try await RiviumSync.shared?.createDatabase(name: name)
                resolve([
                    "id": db?.id ?? "",
                    "name": db?.name ?? ""
                ])
            } catch {
                RiviumSyncModule.rejectWith(reject, "DATABASE_ERROR", error)
            }
        }
    }
    
    @objc func addDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let data = options["data"] as? [String: Any] else {
            reject("ERROR", "databaseId, collectionId, data required", nil)
            return
        }
        
        Task {
            do {
                let doc = try await RiviumSync.shared?.database(databaseId).collection(collectionId).add(data: data)
                resolve(doc?.toDict())
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }
    
    @objc func getDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let documentId = options["documentId"] as? String else {
            reject("ERROR", "databaseId, collectionId, documentId required", nil)
            return
        }
        
        Task {
            do {
                let doc = try await RiviumSync.shared?.database(databaseId).collection(collectionId).get(documentId: documentId)
                resolve(doc?.toDict())
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }
    
    @objc func getAllDocuments(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String else {
            reject("ERROR", "databaseId, collectionId required", nil)
            return
        }
        
        Task {
            do {
                let docs = try await RiviumSync.shared?.database(databaseId).collection(collectionId).getAll() ?? []
                resolve(docs.map { $0.toDict() })
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }
    
    @objc func listenCollection(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "databaseId, collectionId, listenerId required", nil)
            return
        }
        
        let registration = RiviumSync.shared?.database(databaseId).collection(collectionId).listen(callback: { docs in
            guard let module = RiviumSyncModule.shared else { return }
            module.sendEvent(withName: "collectionUpdate", body: [
                "listenerId": listenerId,
                "documents": docs.map { $0.toDict() }
            ])
        }, onError: { error in
            RiviumSyncModule.shared?.sendEvent(withName: "collectionUpdate", body: [
                "listenerId": listenerId,
                "error": RiviumSyncModule.listenerErrorMap(error)
            ])
        })
        
        if let registration = registration {
            listeners[listenerId] = registration
        }
        
        resolve(nil)
    }
    
    @objc func removeCollectionListener(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "listenerId required", nil)
            return
        }

        listeners[listenerId]?.remove()
        listeners.removeValue(forKey: listenerId)
        resolve(nil)
    }

    @objc func listenDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let documentId = options["documentId"] as? String,
              let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "databaseId, collectionId, documentId, listenerId required", nil)
            return
        }

        let registration = RiviumSync.shared?.database(databaseId).collection(collectionId).listenDocument(documentId: documentId, callback: { doc in
            guard let module = RiviumSyncModule.shared else { return }
            var body: [String: Any] = ["listenerId": listenerId]
            if let doc = doc {
                body["document"] = doc.toDict()
            } else {
                body["document"] = NSNull()
            }
            module.sendEvent(withName: "documentUpdate", body: body)
        }, onError: { error in
            RiviumSyncModule.shared?.sendEvent(withName: "documentUpdate", body: [
                "listenerId": listenerId,
                "error": RiviumSyncModule.listenerErrorMap(error)
            ])
        })

        if let registration = registration {
            listeners[listenerId] = registration
        }

        resolve(nil)
    }

    @objc func removeDocumentListener(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "listenerId required", nil)
            return
        }

        listeners[listenerId]?.remove()
        listeners.removeValue(forKey: listenerId)
        resolve(nil)
    }

    @objc func listenQuery(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "databaseId, collectionId, listenerId required", nil)
            return
        }

        let query = RiviumSyncModule.buildQuery(options, databaseId: databaseId, collectionId: collectionId)
        let registration = query?.listen(callback: { docs in
            guard let module = RiviumSyncModule.shared else { return }
            module.sendEvent(withName: "queryUpdate", body: [
                "listenerId": listenerId,
                "documents": docs.map { $0.toDict() }
            ])
        }, onError: { error in
            RiviumSyncModule.shared?.sendEvent(withName: "queryUpdate", body: [
                "listenerId": listenerId,
                "error": RiviumSyncModule.listenerErrorMap(error)
            ])
        })

        if let registration = registration {
            listeners[listenerId] = registration
        }

        resolve(nil)
    }

    /// The query described by the options' filters / orderBy / limit / offset.
    private static func buildQuery(_ options: NSDictionary, databaseId: String, collectionId: String) -> SyncQuery? {
        var query = RiviumSync.shared?.database(databaseId).collection(collectionId).query()

        if let filters = options["filters"] as? [[String: Any]] {
            for filter in filters {
                if let field = filter["field"] as? String,
                   let opString = filter["operator"] as? String {
                    let value = filter["value"]
                    let op: QueryOperator
                    switch opString {
                    case "==": op = .equal
                    case "!=": op = .notEqual
                    case ">": op = .greaterThan
                    case ">=": op = .greaterThanOrEqual
                    case "<": op = .lessThan
                    case "<=": op = .lessThanOrEqual
                    case "array-contains": op = .arrayContains
                    case "in": op = .in
                    case "not-in": op = .notIn
                    default: op = .equal
                    }
                    query = query?.where(field, op, value)
                }
            }
        }

        if let orderBy = options["orderBy"] as? [String: Any],
           let field = orderBy["field"] as? String {
            let direction: OrderDirection = orderBy["direction"] as? String == "desc" ? .descending : .ascending
            query = query?.orderBy(field, direction: direction)
        }

        if let limit = options["limit"] as? Int {
            query = query?.limit(limit)
        }

        if let offset = options["offset"] as? Int {
            query = query?.offset(offset)
        }

        return query
    }

    /// The error a listener event (the listener stopped) or a rejected write carries, read by the JS
    /// RiviumSyncError: `query_not_allowed` with its fields, `listener_revoked`, `permission_denied` (also for
    /// another 403), else UNKNOWN_ERROR; `statusCode` when the server answered.
    static func listenerErrorMap(_ error: Error) -> [String: Any] {
        guard let syncError = error as? RiviumSyncError else {
            return ["code": "UNKNOWN_ERROR", "message": error.localizedDescription]
        }
        switch syncError {
        case .queryNotAllowed(let message, let fields):
            return ["code": "query_not_allowed", "message": message, "fields": fields, "statusCode": 403]
        case .listenerRevoked(let message):
            return ["code": "listener_revoked", "message": message]
        case .permissionError(let message):
            return ["code": "permission_denied", "message": message, "statusCode": 403]
        default:
            var map: [String: Any] = ["message": syncError.localizedDescription]
            let status = syncError.statusCode
            map["code"] = syncError.code ?? (status == 403 ? "permission_denied" : "UNKNOWN_ERROR")
            if let status = status { map["statusCode"] = status }
            return map
        }
    }

    @objc func removeQueryListener(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let listenerId = options["listenerId"] as? String else {
            reject("ERROR", "listenerId required", nil)
            return
        }

        listeners[listenerId]?.remove()
        listeners.removeValue(forKey: listenerId)
        resolve(nil)
    }

    @objc func updateDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let documentId = options["documentId"] as? String,
              let data = options["data"] as? [String: Any] else {
            reject("ERROR", "databaseId, collectionId, documentId, data required", nil)
            return
        }

        Task {
            do {
                let doc = try await RiviumSync.shared?.database(databaseId).collection(collectionId).update(documentId: documentId, data: data)
                resolve(doc?.toDict())
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }

    @objc func setDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let documentId = options["documentId"] as? String,
              let data = options["data"] as? [String: Any] else {
            reject("ERROR", "databaseId, collectionId, documentId, data required", nil)
            return
        }

        Task {
            do {
                // Replace by default; merge only when asked.
                let merge = options["merge"] as? Bool ?? false
                let doc = try await RiviumSync.shared?.database(databaseId).collection(collectionId).set(documentId: documentId, data: data, merge: merge)
                resolve(doc?.toDict())
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }

    @objc func deleteDocument(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String,
              let documentId = options["documentId"] as? String else {
            reject("ERROR", "databaseId, collectionId, documentId required", nil)
            return
        }

        Task {
            do {
                try await RiviumSync.shared?.database(databaseId).collection(collectionId).delete(documentId: documentId)
                resolve(nil)
            } catch {
                RiviumSyncModule.rejectWith(reject, "DOCUMENT_ERROR", error)
            }
        }
    }

    @objc func listCollections(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String else {
            reject("ERROR", "databaseId required", nil)
            return
        }

        Task {
            do {
                let collections = try await RiviumSync.shared?.database(databaseId).listCollections() ?? []
                let result = collections.map { col in
                    return [
                        "id": col.id,
                        "name": col.name,
                        "databaseId": col.databaseId,
                        "documentCount": col.documentCount,
                        "createdAt": col.createdAt,
                        "updatedAt": col.updatedAt
                    ] as [String: Any]
                }
                resolve(result)
            } catch {
                RiviumSyncModule.rejectWith(reject, "COLLECTION_ERROR", error)
            }
        }
    }

    @objc func createCollection(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let name = options["name"] as? String else {
            reject("ERROR", "databaseId and name required", nil)
            return
        }

        Task {
            do {
                let col = try await RiviumSync.shared?.database(databaseId).createCollection(name: name)
                resolve([
                    "id": col?.id ?? "",
                    "name": col?.name ?? "",
                    "databaseId": databaseId
                ])
            } catch {
                RiviumSyncModule.rejectWith(reject, "COLLECTION_ERROR", error)
            }
        }
    }

    @objc func deleteDatabase(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String else {
            reject("ERROR", "databaseId required", nil)
            return
        }

        Task {
            do {
                try await RiviumSync.shared?.deleteDatabase(databaseId: databaseId)
                resolve(nil)
            } catch {
                RiviumSyncModule.rejectWith(reject, "DATABASE_ERROR", error)
            }
        }
    }

    @objc func queryDocuments(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let databaseId = options["databaseId"] as? String,
              let collectionId = options["collectionId"] as? String else {
            reject("ERROR", "databaseId, collectionId required", nil)
            return
        }

        Task {
            do {
                let query = RiviumSyncModule.buildQuery(options, databaseId: databaseId, collectionId: collectionId)
                let docs = try await query?.get() ?? []
                resolve(docs.map { $0.toDict() })
            } catch {
                // query_not_allowed is typed in JS: RiviumSyncError with its fields (error.userInfo).
                RiviumSyncModule.rejectWith(reject, "QUERY_ERROR", error)
            }
        }
    }

    @objc func executeBatch(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let operations = options["operations"] as? [[String: Any]] else {
            reject("ERROR", "operations required", nil)
            return
        }

        Task {
            do {
                guard let batch = RiviumSync.shared?.batch() else {
                    reject("NOT_INITIALIZED", "RiviumSync not initialized", nil)
                    return
                }

                for op in operations {
                    guard let type = op["type"] as? String,
                          let databaseId = op["databaseId"] as? String,
                          let collectionId = op["collectionId"] as? String else {
                        continue
                    }

                    let documentId = op["documentId"] as? String
                    let data = op["data"] as? [String: Any]
                    let merge = op["merge"] as? Bool ?? false

                    guard let collection = RiviumSync.shared?.database(databaseId).collection(collectionId) else {
                        continue
                    }

                    switch type {
                    case "set":
                        if let documentId = documentId, let data = data {
                            batch.set(collection, documentId: documentId, data: data, merge: merge)
                        }
                    case "update":
                        if let documentId = documentId, let data = data {
                            batch.update(collection, documentId: documentId, data: data)
                        }
                    case "delete":
                        if let documentId = documentId {
                            batch.delete(collection, documentId: documentId)
                        }
                    case "create":
                        if let data = data {
                            batch.create(collection, data: data)
                        }
                    default:
                        break
                    }
                }

                try await batch.commit()
                resolve(nil)
            } catch {
                RiviumSyncModule.rejectWith(reject, "BATCH_ERROR", error)
            }
        }
    }

    // MARK: - Offline API

    @objc func getSyncState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let state = RiviumSync.shared?.syncState ?? .idle
        let stateString: String
        switch state {
        case .idle: stateString = "idle"
        case .syncing: stateString = "syncing"
        case .offline: stateString = "offline"
        case .error: stateString = "error"
        }
        resolve(stateString)
    }

    @objc func getPendingCount(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let count = RiviumSync.shared?.pendingCount ?? 0
        resolve(count)
    }

    @objc func forceSyncNow(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        RiviumSync.shared?.forceSyncNow()
        resolve(nil)
    }

    @objc func clearOfflineCache(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        RiviumSync.shared?.clearOfflineCache()
        resolve(nil)
    }
}

// MARK: - Rejected queued writes
private class RejectedWritesListener: SyncEngine.SyncListener {
    weak var module: RiviumSyncModule?

    init(module: RiviumSyncModule) {
        self.module = module
    }

    func onDocumentRejected(documentId: String, operation: OperationType, error: Error) {
        module?.handleDocumentRejected(documentId: documentId, operation: operation, error: error)
    }
}

// MARK: - RiviumSyncDelegate Helper
private class RiviumSyncDelegateHandler: RiviumSyncDelegate {
    weak var module: RiviumSyncModule?

    init(module: RiviumSyncModule) {
        self.module = module
    }

    func riviumSyncDidConnect(_ riviumSync: RiviumSync) {
        module?.handleConnected()
    }

    func riviumSync(_ riviumSync: RiviumSync, didDisconnectWithError error: Error?) {
        module?.handleDisconnected()
    }

    func riviumSync(_ riviumSync: RiviumSync, didFailToConnectWithError error: Error) {
        module?.handleConnectionFailed(error)
    }
}
