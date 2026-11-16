package dev.anywork.auth

import io.logto.sdk.core.http.RefreshRequestObserver

/** A single SDK operation's durable lease. SDK callbacks can arrive on HTTP
 * workers; every store mutation checks the same generation as logout. */
internal class RefreshJournal(
    private val store: GrantStore,
    private val subject: String,
    private val currentGrant: () -> SavedGrant,
) : RefreshRequestObserver {
    private val owner = store.owner()
    private val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(90)
    override fun remainingMillis(): Long = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())
    @Volatile var pending = false
        private set
    @Volatile var storageUnavailable = false
        private set
    private fun durable(action: () -> Unit) {
        try { action() } catch (error: GrantStorageUnavailable) { storageUnavailable = true; throw error }
    }
    private fun bound(): SavedGrant = currentGrant().also { check(it.subject == subject) }
    override fun beforeRequest() { durable { store.pending(owner, bound()) }; pending = true }
    override fun failedBeforeHeaders() { durable { store.save(owner, bound()) }; pending = false }
    fun commit() { durable { store.save(owner, bound()) }; pending = false }
}
