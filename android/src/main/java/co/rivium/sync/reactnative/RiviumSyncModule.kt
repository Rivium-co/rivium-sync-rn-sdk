package co.rivium.sync.reactnative

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import co.rivium.sync.sdk.*
import co.rivium.sync.sdk.offline.ConflictStrategy
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
        if (options.hasKey("maxSyncRetries")) {
            configBuilder.maxSyncRetries(options.getInt("maxSyncRetries"))
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

        // Start observing sync state changes (for offline persistence)
        startObservingSyncState()

        promise.resolve(null)
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
                promise.reject("DATABASE_ERROR", e.message)
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
                promise.reject("COLLECTION_ERROR", e.message)
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
                promise.reject("COLLECTION_ERROR", e.message)
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
                promise.reject("DOCUMENT_ERROR", e.message)
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
                promise.reject("DOCUMENT_ERROR", e.message)
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
                promise.reject("DOCUMENT_ERROR", e.message)
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
                promise.reject("DOCUMENT_ERROR", e.message)
            }
        }
    }

    @ReactMethod
    fun setDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")
        val data = options.getMap("data")?.toHashMap() ?: return promise.reject("ERROR", "data required")

        scope.launch {
            try {
                val doc = riviumSync?.database(databaseId)?.collection(collectionId)?.set(documentId, data)
                promise.resolve(documentToMap(doc))
            } catch (e: Exception) {
                promise.reject("DOCUMENT_ERROR", e.message)
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
                promise.reject("DOCUMENT_ERROR", e.message)
            }
        }
    }

    // Store pending updates for each listener (for callback-based approach)
    private val pendingCollectionUpdates = java.util.concurrent.ConcurrentHashMap<String, WritableArray>()
    private val collectionUpdatePromises = java.util.concurrent.ConcurrentHashMap<String, Promise>()

    @ReactMethod
    fun listenCollection(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        val registration = riviumSync?.database(databaseId)?.collection(collectionId)?.listen { docs ->
            val docsArray = Arguments.createArray()
            docs.forEach { doc -> docsArray.pushMap(documentToMap(doc)) }

            // Send via event emitter (for iOS compatibility)
            val result = Arguments.createMap().apply {
                putString("listenerId", listenerId)
                putArray("documents", docsArray)
            }
            sendEvent("collectionUpdate", result)

            // Also resolve any waiting promise (for Android callback-based approach)
            val waitingPromise = collectionUpdatePromises.remove(listenerId)
            if (waitingPromise != null) {
                val callbackResult = Arguments.createMap().apply {
                    putString("listenerId", listenerId)
                    val freshDocsArray = Arguments.createArray()
                    docs.forEach { doc -> freshDocsArray.pushMap(documentToMap(doc)) }
                    putArray("documents", freshDocsArray)
                }
                waitingPromise.resolve(callbackResult)
            } else {
                // Store for later retrieval
                val storedDocsArray = Arguments.createArray()
                docs.forEach { doc -> storedDocsArray.pushMap(documentToMap(doc)) }
                pendingCollectionUpdates[listenerId] = storedDocsArray
            }
        }

        registration?.let { listeners[listenerId] = it }
        promise.resolve(null)
    }

    // Callback-based method to wait for next collection update (used by Android)
    @ReactMethod
    fun waitForCollectionUpdate(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        // Check if there's already a pending update
        val pendingUpdate = pendingCollectionUpdates.remove(listenerId)
        if (pendingUpdate != null) {
            val result = Arguments.createMap().apply {
                putString("listenerId", listenerId)
                putArray("documents", pendingUpdate)
            }
            promise.resolve(result)
            return
        }

        // Store the promise to be resolved when update arrives
        collectionUpdatePromises[listenerId] = promise
    }

    @ReactMethod
    fun removeCollectionListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        // Clean up any pending data for this listener
        pendingCollectionUpdates.remove(listenerId)
        // Reject any waiting promise
        collectionUpdatePromises.remove(listenerId)?.reject("LISTENER_REMOVED", "Listener was removed")
        promise.resolve(null)
    }

    // Store pending updates for document listeners
    private val pendingDocumentUpdates = java.util.concurrent.ConcurrentHashMap<String, WritableMap?>()
    private val documentUpdatePromises = java.util.concurrent.ConcurrentHashMap<String, Promise>()

    @ReactMethod
    fun listenDocument(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val documentId = options.getString("documentId") ?: return promise.reject("ERROR", "documentId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        val registration = riviumSync?.database(databaseId)?.collection(collectionId)?.listenDocument(documentId) { doc ->
            // Send via event emitter (for iOS)
            val result = Arguments.createMap().apply {
                putString("listenerId", listenerId)
                if (doc != null) {
                    putMap("document", documentToMap(doc))
                } else {
                    putNull("document")
                }
            }
            sendEvent("documentUpdate", result)

            // Also use callback-based approach (for Android)
            val waitingPromise = documentUpdatePromises.remove(listenerId)
            if (waitingPromise != null) {
                val callbackResult = Arguments.createMap().apply {
                    putString("listenerId", listenerId)
                    if (doc != null) {
                        putMap("document", documentToMap(doc))
                    } else {
                        putNull("document")
                    }
                }
                waitingPromise.resolve(callbackResult)
            } else {
                pendingDocumentUpdates[listenerId] = if (doc != null) documentToMap(doc) else null
            }
        }

        registration?.let { listeners[listenerId] = it }
        promise.resolve(null)
    }

    // Callback-based method to wait for next document update (used by Android)
    @ReactMethod
    fun waitForDocumentUpdate(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        // Check if there's already a pending update
        if (pendingDocumentUpdates.containsKey(listenerId)) {
            val pendingUpdate = pendingDocumentUpdates.remove(listenerId)
            val result = Arguments.createMap().apply {
                putString("listenerId", listenerId)
                if (pendingUpdate != null) {
                    putMap("document", pendingUpdate)
                } else {
                    putNull("document")
                }
            }
            promise.resolve(result)
            return
        }

        documentUpdatePromises[listenerId] = promise
    }

    @ReactMethod
    fun removeDocumentListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        // Clean up any pending data
        pendingDocumentUpdates.remove(listenerId)
        documentUpdatePromises.remove(listenerId)?.reject("LISTENER_REMOVED", "Listener was removed")
        promise.resolve(null)
    }

    @ReactMethod
    fun listenQuery(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")

        scope.launch {
            try {
                var query = riviumSync?.database(databaseId)?.collection(collectionId)?.query()

                options.getArray("filters")?.let { filters ->
                    for (i in 0 until filters.size()) {
                        val filter = filters.getMap(i)
                        val field = filter.getString("field") ?: continue
                        val operator = filter.getString("operator") ?: continue
                        val value = filter.getDynamic("value")?.asString()
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

                if (options.hasKey("limit")) {
                    query = query?.limit(options.getInt("limit"))
                }

                if (options.hasKey("offset")) {
                    query = query?.offset(options.getInt("offset"))
                }

                val registration = query?.listen { docs ->
                    val result = Arguments.createMap().apply {
                        putString("listenerId", listenerId)
                        val docsArray = Arguments.createArray()
                        docs.forEach { doc -> docsArray.pushMap(documentToMap(doc)) }
                        putArray("documents", docsArray)
                    }
                    sendEvent("queryUpdate", result)
                }

                registration?.let { listeners[listenerId] = it }
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("QUERY_ERROR", e.message)
            }
        }
    }

    @ReactMethod
    fun removeQueryListener(options: ReadableMap, promise: Promise) {
        val listenerId = options.getString("listenerId") ?: return promise.reject("ERROR", "listenerId required")
        listeners.remove(listenerId)?.remove()
        promise.resolve(null)
    }

    @ReactMethod
    fun queryDocuments(options: ReadableMap, promise: Promise) {
        val databaseId = options.getString("databaseId") ?: return promise.reject("ERROR", "databaseId required")
        val collectionId = options.getString("collectionId") ?: return promise.reject("ERROR", "collectionId required")

        scope.launch {
            try {
                var query = riviumSync?.database(databaseId)?.collection(collectionId)?.query()

                options.getArray("filters")?.let { filters ->
                    for (i in 0 until filters.size()) {
                        val filter = filters.getMap(i)
                        val field = filter.getString("field") ?: continue
                        val operator = filter.getString("operator") ?: continue
                        val value = filter.getDynamic("value")?.asString()
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

                if (options.hasKey("limit")) {
                    query = query?.limit(options.getInt("limit"))
                }

                if (options.hasKey("offset")) {
                    query = query?.offset(options.getInt("offset"))
                }

                val docs = query?.get() ?: emptyList()
                val result = Arguments.createArray()
                docs.forEach { doc -> result.pushMap(documentToMap(doc)) }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("QUERY_ERROR", e.message)
            }
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

                    val collection = riviumSync?.database(databaseId)?.collection(collectionId) ?: continue

                    when (type) {
                        "set" -> {
                            if (documentId != null && data != null) {
                                batch.set(collection, documentId, data)
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
                promise.reject("BATCH_ERROR", e.message)
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
