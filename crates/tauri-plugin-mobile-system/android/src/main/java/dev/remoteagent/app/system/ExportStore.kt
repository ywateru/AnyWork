package dev.remoteagent.app.system

import java.io.File
import java.util.UUID

internal class SystemFailure(val code: String) : Exception(code)

/** Private, bounded, process-scoped files. All calls are serialized by the plugin worker. */
internal class ExportStore(private val root: File, private val now: () -> Long, private val onRemove: (Entry) -> Unit = {}) {
    companion object {
        const val MAX_BYTES = 22L * 1024 * 1024
        const val MAX_CHUNK = 64 * 1024
        const val TTL = 10L * 60 * 1000
    }
    internal data class Entry(
        val handle: String, val file: File, val name: String, val mime: String,
        val expected: Long, val purpose: String, var expires: Long,
        var received: Long = 0, var sequence: Long = 0, var sealed: Boolean = false,
        @Volatile var live: Boolean = true
    )
    private val entries = LinkedHashMap<String, Entry>()
    init {
        // Only this task's dedicated cache subdirectory; never user-selected destinations.
        root.mkdirs()
        root.listFiles()?.forEach { if (it.isFile) it.delete() }
    }
    fun begin(name: String, mime: String, expected: Long, purpose: String): Entry {
        sweep()
        if (entries.size >= 2) throw SystemFailure("LIMIT_EXCEEDED")
        if (expected < 0 || expected > MAX_BYTES) throw SystemFailure("LIMIT_EXCEEDED")
        if (name.isBlank() || name.length > 240 || name.any { it == '/' || it == '\\' || it.code < 32 } ||
            !mime.matches(Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) ||
            purpose !in listOf("save", "share")) throw SystemFailure("INVALID_REQUEST")
        val handle = UUID.randomUUID().toString()
        val file = File(root, handle)
        if (!file.createNewFile()) throw SystemFailure("SYSTEM_FAILED")
        return Entry(handle, file, name, mime, expected, purpose, now() + TTL).also { entries[handle] = it }
    }
    fun get(handle: String): Entry {
        val e = entries[handle] ?: throw SystemFailure("INVALID_HANDLE")
        if (now() >= e.expires) { abort(handle); throw SystemFailure("HANDLE_EXPIRED") }
        return e
    }
    fun write(handle: String, sequence: Long, data: ByteArray): Long {
        val e = get(handle)
        if (e.sealed || sequence != e.sequence) throw SystemFailure("INVALID_SEQUENCE")
        if (data.isEmpty() || data.size > MAX_CHUNK || e.received + data.size > e.expected) throw SystemFailure("LIMIT_EXCEEDED")
        try { e.file.appendBytes(data) }
        catch (error: Exception) { abort(handle); throw error }
        e.received += data.size
        e.sequence++
        return e.received
    }
    fun seal(handle: String): Entry {
        val e = get(handle)
        if (e.sealed || e.received != e.expected || e.file.length() != e.received) throw SystemFailure("INVALID_REQUEST")
        e.sealed = true
        return e
    }
    fun abort(handle: String) { entries.remove(handle)?.let { it.live = false; onRemove(it); it.file.delete() } }
    fun abortAll() { entries.keys.toList().forEach(::abort) }
    fun sweep() { entries.values.filter { now() >= it.expires }.map { it.handle }.forEach(::abort) }
}
