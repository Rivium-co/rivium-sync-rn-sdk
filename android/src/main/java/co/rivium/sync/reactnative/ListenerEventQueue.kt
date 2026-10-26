package co.rivium.sync.reactnative

import com.facebook.react.bridge.Promise

/**
 * Hands one kind of listener events (collection, document or query) to JS on Android, where JS keeps one
 * `waitFor*Update` promise open per listener and asks again after each event.
 *
 * An event that arrives while no promise is waiting is kept until the next wait. Snapshots replace an older kept
 * snapshot (only the latest results matter); an error is always kept, after the snapshot before it.
 */
internal class ListenerEventQueue {
    private class Entry {
        val events = ArrayDeque<Pair<Boolean, () -> Any?>>() // (isError, event)
        var waiting: Promise? = null
    }

    private val entries = HashMap<String, Entry>()

    /** Start keeping events for [listenerId]. */
    @Synchronized
    fun open(listenerId: String) {
        entries.getOrPut(listenerId) { Entry() }
    }

    /** A new event for [listenerId]. [event] builds it; it is built once, when it is handed over. */
    fun offer(listenerId: String, isError: Boolean, event: () -> Any?) {
        val promise: Promise
        synchronized(this) {
            val entry = entries[listenerId] ?: return // removed
            val waiting = entry.waiting
            if (waiting == null) {
                val last = entry.events.lastOrNull()
                if (!isError && last != null && !last.first) entry.events.removeLast()
                entry.events.addLast(isError to event)
                return
            }
            entry.waiting = null
            promise = waiting
        }
        promise.resolve(event())
    }

    /** JS waits for the next event of [listenerId]. */
    fun waitFor(listenerId: String, promise: Promise) {
        var removed = false
        var replaced: Promise? = null
        var next: (() -> Any?)? = null
        synchronized(this) {
            val entry = entries[listenerId]
            if (entry == null) {
                removed = true
            } else {
                next = entry.events.removeFirstOrNull()?.second
                if (next == null) {
                    replaced = entry.waiting
                    entry.waiting = promise
                }
            }
        }
        replaced?.reject(LISTENER_REMOVED, "Replaced by a newer wait")
        val event = next
        when {
            removed -> promise.reject(LISTENER_REMOVED, "Listener was removed")
            event != null -> promise.resolve(event())
        }
    }

    /** Stop [listenerId]: drop its kept events and end its waiting promise. */
    fun close(listenerId: String) {
        val waiting = synchronized(this) { entries.remove(listenerId)?.waiting }
        waiting?.reject(LISTENER_REMOVED, "Listener was removed")
    }

    companion object {
        const val LISTENER_REMOVED = "LISTENER_REMOVED"
    }
}
