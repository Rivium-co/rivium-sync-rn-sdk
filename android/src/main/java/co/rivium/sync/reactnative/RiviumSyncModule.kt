package co.rivium.sync.reactnative

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import co.rivium.sync.sdk.*
import co.rivium.sync.sdk.offline.ConflictInfo
import co.rivium.sync.sdk.offline.ConflictStrategy
import co.rivium.sync.sdk.offline.OperationType
import co.rivium.sync.sdk.offline.SyncState
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

private const val TAG = "RiviumSyncRN"

class RiviumSyncModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var riviumSync: RiviumSync? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val listeners = mutableMapOf<String, ListenerRegistration>()

    // Jobs for observing sync state changes
    private var syncStateJob: Job? = null
    private var pendingCountJob: Job? = null

    // Cache connection state to emit when JS listener is added
    private var lastConnectionState: Boolean? = null
    private var hasConnectionListener = false

    override fun getName() = "RiviumSync"

    private fun sendEvent(eventName: String, params: Any?) {
        if (!reactApplicationContext.hasActiveReactInstance()) {
            return
        }

        // Ensure we emit events on the UI thread for proper bridge communication
        val emitRunnable = Runnable {
            try {
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            } catch (e: Exception) {
                Log.e(TAG, "sendEvent error: ${e.message}")
            }
        }

        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            android.os.Handler(android.os.Looper.getMainLooper()).post(emitRunnable)
        } else {
            emitRunnable.run()
        }
    }

    @ReactMethod
    fun init(options: ReadableMap, promise: Promise) {
        val apiKey = options.getString("apiKey") ?: return promise.reject("ERROR", "apiKey required")

        // Parse offline enabled (handle both Boolean and other types)
        val offlineEnabled = when {
            options.hasKey("offlineEnabled") -> {
                try {
                    options.getBoolean("offlineEnabled")
                } catch (e: Exception) {
                    false
                }
            }
            else -> false
        }


        val configBuilder = RiviumSyncConfig.builder(apiKey)
            .debugMode(if (options.hasKey("debugMode")) options.getBoolean("debugMode") else false)
            .autoReconnect(if (options.hasKey("autoReconnect")) options.getBoolean("autoReconnect") else true)
            .offlineEnabled(offlineEnabled)

        // userId for Security Rules (auth.uid). The server cannot trust it -
        // use a signed token where it matters.
        if (options.hasKey("userId") && !options.isNull("userId")) {
            options.getString("userId")?.let { configBuilder.userId(it) }
        }

        // Signed user token, minted by the app's own backend.
        if (options.hasKey("userToken") && !options.isNull("userToken")) {
            options.getString("userToken")?.let { configBuilder.userToken(it) }
        }

        // Other offline persistence options
        if (options.hasKey("offlineCacheSizeMb")) {
            configBuilder.offlineCacheSizeMb(options.getInt("offlineCacheSizeMb"))
        }
        if (options.hasKey("syncOnReconnect")) {
            configBuilder.syncOnReconnect(options.getBoolean("syncOnReconnect"))
        }
        if (options.hasKey("conflictStrategy")) {
            val strategy = options.getString("conflictStrategy")
            val conflictStrategy = when (strategy) {
                "clientWins" -> ConflictStrategy.CLIENT_WINS
                "merge" -> ConflictStrategy.MERGE
                "manual" -> ConflictStrategy.MANUAL
                else -> ConflictStrategy.SERVER_WINS
            }
            configBuilder.conflictStrategy(conflictStrategy)
        }

        // A local Rivium Sync server (JS `emulator`): plain HTTP and realtime without TLS.
        if (options.hasKey("emulatorHost") && !options.isNull("emulatorHost")) {
            val host = options.getString("emulatorHost") ?: ""
            val port = if (options.hasKey("emulatorPort") && !options.isNull("emulatorPort")) options.getInt("emulatorPort") else 3006
            try {
                configBuilder.useEmulator(host, port)
            } catch (e: IllegalArgumentException) {
                return promise.reject("ERROR", e.message)
            }
        }

        // Report this package (react-native/<version>) in the X-Rivium-SDK header.
        configBuilder.wrapperSdk(
            if (options.hasKey("wrapperSdkName")) options.getString("wrapperSdkName") else null,
            if (options.hasKey("wrapperSdkVersion")) options.getString("wrapperSdkVersion") else null,
        )

        val config = configBuilder.build()

        riviumSync = RiviumSync.initialize(reactApplicationContext, config)

        riviumSync?.setConnectionListener(object : RiviumSync.ConnectionListener {
            override fun onConnected() {
                lastConnectionState = true
                sendEvent("onConnectionState", true)
            }

            override fun onDisconnected(cause: Throwable?) {
                lastConnectionState = false
                sendEvent("onConnectionState", false)
            }

            override fun onConnectionFailed(cause: Throwable) {
                val errorMap = Arguments.createMap().apply {
                    putString("code", "connectionError")
                    putString("message", cause.message ?: "Connection failed")
                }
                sendEvent("onError", errorMap)
            }
        })

        // The project requires a user token and none is set yet: connect() is
        // parked, not failed. The SDK connects when setUserToken supplies one.
        riviumSync?.onAwaitingUserToken = { sendEvent("onAwaitingUserToken", null) }

        // Queued writes the server refused (offline persistence only): JS onDocumentRejected.
        riviumSync?.addSyncListener(rejectedWrites)

        // Start observing sync state changes (for offline persistence)
        startObservingSyncState()

        promise.resolve(null)
    }

    /** Forwards queued writes the server refused to JS as `onDocumentRejected`. */
    private val rejectedWrites = object : SyncListener {
        override fun onSyncStarted() {}
        override fun onSyncCompleted(syncedCount: Int) {}
        override fun onSyncFailed(error: Throwable) {}
        override fun onConflictDetected(conflict: ConflictInfo) {}
        override fun onDocumentSynced(documentId: String, operation: OperationType) {}
        override fun onDocumentRejected(documentId: String, operation: OperationType, error: Throwable) {
            sendEvent("onDocumentRejected", Arguments.createMap().apply {
                putString("documentId", documentId)
                putString("operation", operation.name.lowercase())
                putMap("error", errorMap(error))
            })
        }
    }

    /**
     * Rejects [promise] with [code] and the error's message; when the server answered, its HTTP status is in the
     * rejection's userInfo (`statusCode`), which JS turns into a RiviumSyncError. A query the rules do not allow
     * (also `getAll()`) is rejected as `query_not_allowed` with its fields.
     */
    private fun reject(promise: Promise, code: String, e: Throwable) {
        if (e is RiviumSyncException.QueryNotAllowedException) {
            val userInfo = Arguments.createMap().apply {
                putArray("fields", Arguments.fromList(e.fields))
                putInt("statusCode", 403)
            }
            promise.reject("query_not_allowed", e.message, e, userInfo)
            return
        }
        // A failed batch wraps the server's answer (BatchWriteException).
        val status = ((e as? RiviumSyncException.NetworkException) ?: (e.cause as? RiviumSyncException.NetworkException))?.statusCode
        if (status == null) {
            promise.reject(code, e.message, e)
            return
        }
        val userInfo = Arguments.createMap().apply { putInt("statusCode", status) }
        promise.reject(code, e.message, e, userInfo)
    }

    /**
     * Start observing sync state and pending count changes from the SyncEngine.
     * This emits events to JavaScript so the UI can react to sync state changes.
     */
    private fun startObservingSyncState() {
        // Cancel any existing observation jobs
        syncStateJob?.cancel()
        pendingCountJob?.cancel()

        // Observe sync state
        riviumSync?.getSyncState()?.let { stateFlow ->
            syncStateJob = scope.launch {
                stateFlow.collectLatest { state ->
                    val stateString = when (state) {
                        SyncState.IDLE -> "idle"
                        SyncState.SYNCING -> "syncing"
                        SyncState.OFFLINE -> "offline"
                        SyncState.ERROR -> "error"
                    }
                    Log.d(TAG, "SyncState changed to: $stateString")
                    sendEvent("onSyncState", stateString)
                }
            }
        }

        // Observe pending count
        riviumSync?.getPendingCount()?.let { countFlow ->
            pendingCountJob = scope.launch {
                countFlow.collectLatest { count ->
                    Log.d(TAG, "PendingCount changed to: $count")
                    sendEvent("onPendingCount", count)
                }
            }
        }
    }

    @ReactMethod
    fun setUserToken(token: String?, promise: Promise) {
        val sync = riviumSync
        if (sync == null) {
            promise.reject("notInitialized", "Call init before setUserToken")
            return
        }
        sync.userTokens.set(token)
        promise.resolve(null)
    }

    @ReactMethod
    fun connect(promise: Promise) {
        riviumSync?.connect(
            onSuccess = { promise.resolve(null) },
            onError = { error -> promise.reject("CONNECTION_ERROR", error.message) }
        )
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        riviumSync?.disconnect()
        promise.resolve(null)
    }

    @ReactMethod
    fun isConnected(promise: Promise) {
        promise.resolve(riviumSync?.isConnected() ?: false)
    }

    @ReactMethod
    fun isAwaitingUserToken(promise: Promise) {
        promise.resolve(riviumSync?.isAwaitingUserToken ?: false)
    }

    @ReactMethod
    fun listDatabases(promise: Promise) {
        scope.launch {
            try {
                val databases = riviumSync?.listDatabases() ?: emptyList()
                val result = Arguments.createArray()
                databases.forEach { db ->
                    val map = Arguments.createMap().apply {
                        putString("id", db.id)
                        putString("name", db.name)
                        putDouble("createdAt", db.createdAt.toDouble())
                        putDouble("updatedAt", db.updatedAt.toDouble())
                    }
                    result.pushMap(map)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                reject(promise, "DATABASE_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun createDatabase(options: ReadableMap, promise: Promise) {
        promise.reject("NOT_SUPPORTED", "createDatabase is not supported. Databases are auto-created.")
    }

    @ReactMethod
    fun deleteDatabase(options: ReadableMap, promise: Promise) {
        promise.reject("NOT_SUPPORTED", "deleteDatabase is not supported in this SDK version")
    }

    @ReactMethod
    fun listCollections(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        scope.launch {
            try {
                val collections = riviumSync?.database(databaseId)?.listCollections() ?: emptyList()
                val result = Arguments.createArray()
                collections.forEach { col ->
                    val map = Arguments.createMap().apply {
                        putString("id", col.id)
                        putString("name", col.name)
                        putString("databaseId", col.databaseId)
                        putInt("documentCount", col.documentCount)
                        putDouble("createdAt", col.createdAt.toDouble())
                        putDouble("updatedAt", col.updatedAt.toDouble())
                    }
                    result.pushMap(map)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                reject(promise, "COLLECTION_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun createCollection(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val name = options.getString("name") ?: return promise.reject("ERROR", "name required")
        scope.launch {
            try {
                val col = riviumSync?.database(databaseId)?.createCollection(name)
                val result = Arguments.createMap().apply {
                    putString("id", col?.id)
                    putString("name", col?.name)
                    putString("databaseId", databaseId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                reject(promise, "COLLECTION_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun addDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val data = options.getMap("data")?.toHashMap() ?: return promise.reject("ERROR", "data required")

        scope.launch {
            try {
                val doc = riviumSync?.database(databaseId)?.collection(collectionId)?.add(data)
                promise.resolve(documentToMap(doc))
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun getDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")

        scope.launch {
            try {
                val doc = riviumSync?.database(databaseId)?.collection(collectionId)?.get(documentId)
                promise.resolve(doc?.let { documentToMap(it) })
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun getAllDocuments(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")

        scope.launch {
            try {
                val docs = riviumSync?.database(databaseId)?.collection(collectionId)?.getAll() ?: emptyList()
                val result = Arguments.createArray()
                docs.forEach { doc -> result.pushMap(documentToMap(doc)) }
                promise.resolve(result)
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun updateDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")
        val data = options.getMap("data")?.toHashMap() ?: return promise.reject("ERROR", "data required")

        scope.launch {
            try {
                val doc = riviumSync?.database(databaseId)?.collection(collectionId)?.update(documentId, data)
                promise.resolve(documentToMap(doc))
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun setDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")
        val data = options.getMap("data")?.toHashMap() ?: return promise.reject("ERROR", "data required")
        // Replace by default; merge only when asked.
        val merge = options.hasKey("merge") && !options.isNull("merge") && options.getBoolean("merge")

        scope.launch {
            try {
                val doc = riviumSync?.database(databaseId)?.collection(collectionId)?.set(documentId, data, merge)
                promise.resolve(documentToMap(doc))
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    @ReactMethod
    fun deleteDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")

        scope.launch {
            try {
                riviumSync?.database(databaseId)?.collection(collectionId)?.delete(documentId)
                promise.resolve(null)
            } catch (e: Exception) {
                reject(promise, "DOCUMENT_ERROR", e)
            }
        }
    }

    // ==================== Listeners ====================
    //
    // Each listener's events reach JS two ways: the event emitter (iOS-style, "collectionUpdate" / "documentUpdate"
    // / "queryUpdate") and a promise the JS side keeps waiting on (waitFor*Update), which is what JS uses on
    // Android. An event is { listenerId, documents | document } or, when the listener stopped, { listenerId, error }.

    private val collectionEvents = ListenerEventQueue()
    private val documentEvents = ListenerEventQueue()
    private val queryEvents = ListenerEventQueue()

    private fun documentsEvent(listenerId: String, docs: List<SyncDocument>): () -> WritableMap = {
        Arguments.createMap().apply {
            putString("listenerId", listenerId)
            val docsArray = Arguments.createArray()
            docs.forEach { doc -> docsArray.pushMap(documentToMap(doc)) }
            putArray("documents", docsArray)
        }
    }

    private fun documentEvent(listenerId: String, doc: SyncDocument?): () -> WritableMap = {
        Arguments.createMap().apply {
            putString("listenerId", listenerId)
            if (doc != null) putMap("document", documentToMap(doc)) else putNull("document")
        }
    }

    private fun errorEvent(listenerId: String, error: RiviumSyncException): () -> WritableMap = {
        Arguments.createMap().apply {
            putString("listenerId", listenerId)
            putMap("error", errorMap(error))
        }
    }

    /** Emits [event] as [eventName] and hands it to the listener's waiting promise (or keeps it for the next wait). */
    private fun deliver(queue: ListenerEventQueue, eventName: String, listenerId: String, isError: Boolean, event: () -> WritableMap) {
        sendEvent(eventName, event())
        queue.offer(listenerId, isError, event)
    }

    @ReactMethod
    fun listenCollection(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        collectionEvents.open(listenerId)
        val registration = riviumSync?.database(databaseId)?.collection(collectionId)?.listen(
            { docs -> deliver(collectionEvents, "collectionUpdate", listenerId, false, documentsEvent(listenerId, docs)) },
            { error -> deliver(collectionEvents, "collectionUpdate", listenerId, true, errorEvent(listenerId, error)) }
        )

        registration?.let { listeners[listenerId] = it }
        promise.resolve(null)
    }

    // Callback-based method to wait for next collection update (used by Android)
    @ReactMethod
    fun waitForCollectionUpdate(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        collectionEvents.waitFor(listenerId, promise)
    }

    @ReactMethod
    fun removeCollectionListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        collectionEvents.close(listenerId)
        promise.resolve(null)
    }

    @ReactMethod
    fun listenDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        documentEvents.open(listenerId)
        val registration = riviumSync?.database(databaseId)?.collection(collectionId)?.listenDocument(
            documentId,
            { doc -> deliver(documentEvents, "documentUpdate", listenerId, false, documentEvent(listenerId, doc)) },
            { error -> deliver(documentEvents, "documentUpdate", listenerId, true, errorEvent(listenerId, error)) }
        )

        registration?.let { listeners[listenerId] = it }
        promise.resolve(null)
    }

    // Callback-based method to wait for next document update (used by Android)
    @ReactMethod
    fun waitForDocumentUpdate(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        documentEvents.waitFor(listenerId, promise)
    }

    @ReactMethod
    fun removeDocumentListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        documentEvents.close(listenerId)
        promise.resolve(null)
    }

    @ReactMethod
    fun listenQuery(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        try {
            queryEvents.open(listenerId)
            val registration = buildQuery(options, databaseId, collectionId)?.listen(
                { docs -> deliver(queryEvents, "queryUpdate", listenerId, false, documentsEvent(listenerId, docs)) },
                { error -> deliver(queryEvents, "queryUpdate", listenerId, true, errorEvent(listenerId, error)) }
            )

            registration?.let { listeners[listenerId] = it }
            promise.resolve(null)
        } catch (e: Exception) {
            reject(promise, "QUERY_ERROR", e)
        }
    }

    // Callback-based method to wait for next query update (used by Android)
    @ReactMethod
    fun waitForQueryUpdate(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        queryEvents.waitFor(listenerId, promise)
    }

    @ReactMethod
    fun removeQueryListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        queryEvents.close(listenerId)
        promise.resolve(null)
    }

    @ReactMethod
    fun queryDocuments(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")

        scope.launch {
            try {
                val docs = buildQuery(options, databaseId, collectionId)?.get() ?: emptyList()
                val result = Arguments.createArray()
                docs.forEach { doc -> result.pushMap(documentToMap(doc)) }
                promise.resolve(result)
            } catch (e: Exception) {
                // query_not_allowed is typed in JS: RiviumSyncError with these fields (error.userInfo).
                reject(promise, "QUERY_ERROR", e)
            }
        }
    }

    /**
     * The query described by the options' filters / orderBy / limit / offset. Filter values keep their JSON type
     * (numbers and booleans are not turned into strings: the server compares by type).
     */
    private fun buildQuery(options: ReadableMap, databaseId: String, collectionId: String): SyncQuery? {
        var query = riviumSync?.database(databaseId)?.collection(collectionId)?.query()

        options.getArray("filters")?.let { filters ->
            for (i in 0 until filters.size()) {
                val filter = filters.getMap(i) ?: continue
                val field = filter.getString("field") ?: continue
                val operator = filter.getString("operator") ?: continue
                val value = filterValue(filter)
                val op = when (operator) {
                    "==" -> QueryOperator.EQUAL
                    "!=" -> QueryOperator.NOT_EQUAL
                    ">" -> QueryOperator.GREATER_THAN
                    ">=" -> QueryOperator.GREATER_THAN_OR_EQUAL
                    "<" -> QueryOperator.LESS_THAN
                    "<=" -> QueryOperator.LESS_THAN_OR_EQUAL
                    "array-contains" -> QueryOperator.ARRAY_CONTAINS
                    "in" -> QueryOperator.IN
                    "not-in" -> QueryOperator.NOT_IN
                    else -> QueryOperator.EQUAL
                }
                query = query?.where(field, op, value)
            }
        }

        options.getMap("orderBy")?.let { orderBy ->
            val field = orderBy.getString("field") ?: return@let
            val direction = if (orderBy.getString("direction") == "desc") OrderDirection.DESCENDING else OrderDirection.ASCENDING
            query = query?.orderBy(field, direction)
        }

        if (options.hasKey("limit") && !options.isNull("limit")) {
            query = query?.limit(options.getInt("limit"))
        }

        if (options.hasKey("offset") && !options.isNull("offset")) {
            query = query?.offset(options.getInt("offset"))
        }
        return query
    }

    /** A filter's value as its JSON type: String, Boolean, Double, null, or a List / Map of those. */
    private fun filterValue(filter: ReadableMap): Any? =
        if (!filter.hasKey("value") || filter.isNull("value")) null else filter.toHashMap()["value"]

    /**
     * The error map a listener event (the listener stopped) or a rejected write carries, read by the JS
     * RiviumSyncError: `query_not_allowed` with its fields, `listener_revoked`, `permission_denied` for another
     * 403, else the server's code; `statusCode` when the server answered.
     */
    private fun errorMap(e: Throwable): WritableMap = Arguments.createMap().apply {
        putString("message", e.message)
        when (e) {
            is RiviumSyncException.QueryNotAllowedException -> {
                putString("code", "query_not_allowed")
                putArray("fields", Arguments.fromList(e.fields))
                putInt("statusCode", 403)
            }
            is RiviumSyncException.NetworkException -> {
                putString("code", e.code ?: if (e.statusCode == 403) "permission_denied" else "UNKNOWN_ERROR")
                e.statusCode?.let { putInt("statusCode", it) }
            }
            else -> putString("code", "UNKNOWN_ERROR")
        }
    }

    @ReactMethod
    fun executeBatch(options: ReadableMap, promise: Promise) {
        val operations = options.getArray("operations") ?: return promise.reject("ERROR", "operations required")

        scope.launch {
            try {
                // Create a WriteBatch and add all operations
                val batch = riviumSync?.batch() ?: return@launch promise.reject("NOT_INITIALIZED", "RiviumSync not initialized")

                for (i in 0 until operations.size()) {
                    val op = operations.getMap(i)
                    val type = op.getString("type") ?: continue
                    val databaseId = op.getString("databaseId") ?: continue
                    val collectionId = op.getString("collectionId") ?: continue
                    val documentId = op.getString("documentId")
                    val data = op.getMap("data")?.toHashMap()
                    val merge = op.hasKey("merge") && !op.isNull("merge") && op.getBoolean("merge")

                    val collection = riviumSync?.database(databaseId)?.collection(collectionId) ?: continue

                    when (type) {
                        "set" -> {
                            if (documentId != null && data != null) {
                                batch.set(collection, documentId, data, merge)
                            }
                        }
                        "update" -> {
                            if (documentId != null && data != null) {
                                batch.update(collection, documentId, data)
                            }
                        }
                        "delete" -> {
                            if (documentId != null) {
                                batch.delete(collection, documentId)
                            }
                        }
                        "create" -> {
                            if (data != null) {
                                batch.create(collection, data)
                            }
                        }
                    }
                }

                batch.commit()
                promise.resolve(null)
            } catch (e: Exception) {
                reject(promise, "BATCH_ERROR", e)
            }
        }
    }

    // ==================== Offline Persistence Methods ====================

    @ReactMethod
    fun getSyncState(promise: Promise) {
        try {
            val stateFlow = riviumSync?.getSyncState()
            val state = stateFlow?.value?.name?.lowercase() ?: "idle"
            promise.resolve(state)
        } catch (e: Exception) {
            promise.resolve("idle")
        }
    }

    @ReactMethod
    fun getPendingCount(promise: Promise) {
        try {
            val countFlow = riviumSync?.getPendingCount()
            val count = countFlow?.value ?: 0
            promise.resolve(count)
        } catch (e: Exception) {
            promise.resolve(0)
        }
    }

    @ReactMethod
    fun forceSyncNow(promise: Promise) {
        try {
            riviumSync?.forceSyncNow()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearOfflineCache(promise: Promise) {
        scope.launch {
            try {
                riviumSync?.clearOfflineCache()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("CACHE_ERROR", e.message)
            }
        }
    }

    @ReactMethod
    fun isOfflineEnabled(promise: Promise) {
        try {
            val enabled = riviumSync?.isOfflineEnabled() ?: false
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    // ==================== Event Emitter ====================

    @ReactMethod
    fun addListener(eventName: String) {
        // When JS adds a connection state listener, emit the cached state if we have one
        if (eventName == "onConnectionState") {
            hasConnectionListener = true
            lastConnectionState?.let { state ->
                scope.launch {
                    kotlinx.coroutines.delay(50)
                    sendEvent("onConnectionState", state)
                }
            }
        }
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required by React Native for NativeEventEmitter
    }

    private fun documentToMap(doc: SyncDocument?): WritableMap? {
        if (doc == null) return null
        return Arguments.createMap().apply {
            putString("id", doc.id)
            putMap("data", Arguments.makeNativeMap(doc.data))
            putDouble("createdAt", doc.createdAt.toDouble())
            putDouble("updatedAt", doc.updatedAt.toDouble())
            putInt("version", doc.version)
        }
    }
}
