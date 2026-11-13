package dev.remoteagent.app.system

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class ExportStoreTest {
    private fun fixture(block: (ExportStore, java.io.File, (Long) -> Unit) -> Unit) {
        val root = Files.createTempDirectory("anywork-export-unit").toFile()
        var clock = 0L
        try { block(ExportStore(root, { clock }), root) { clock = it } }
        finally { root.deleteRecursively() }
    }
    private fun rejects(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: SystemFailure) { assertEquals(code, error.code) }
    }
    @Test fun sequential_chunks_produce_exact_bytes_and_seal_once() = fixture { store, _, _ ->
        val e = store.begin("中文.txt", "text/plain", 3, "save")
        assertEquals(2L, store.write(e.handle, 0, byteArrayOf(1, 2)))
        rejects("INVALID_SEQUENCE") { store.write(e.handle, 0, byteArrayOf(3)) }
        rejects("INVALID_REQUEST") { store.seal(e.handle) }
        assertEquals(3L, store.write(e.handle, 1, byteArrayOf(3)))
        assertArrayEquals(byteArrayOf(1, 2, 3), store.seal(e.handle).file.readBytes())
        rejects("INVALID_REQUEST") { store.seal(e.handle) }
        rejects("INVALID_SEQUENCE") { store.write(e.handle, 2, byteArrayOf(4)) }
    }
    @Test fun limit_checks_happen_before_creating_or_writing_files() = fixture { store, root, _ ->
        rejects("LIMIT_EXCEEDED") { store.begin("a", "text/plain", ExportStore.MAX_BYTES + 1, "save") }
        assertEquals(0, root.listFiles()!!.size)
        val a = store.begin("a", "application/octet-stream", ExportStore.MAX_BYTES, "save")
        rejects("LIMIT_EXCEEDED") { store.write(a.handle, 0, ByteArray(ExportStore.MAX_CHUNK + 1)) }
        assertEquals(0L, a.file.length())
        store.begin("b", "text/plain", 0, "share")
        rejects("LIMIT_EXCEEDED") { store.begin("c", "text/plain", 0, "save") }
        assertEquals(2, root.listFiles()!!.size)
    }
    @Test fun declared_size_cannot_be_overrun() = fixture { store, _, _ ->
        val e = store.begin("a", "text/plain", 1, "save")
        rejects("LIMIT_EXCEEDED") { store.write(e.handle, 0, byteArrayOf(1, 2)) }
        assertEquals(0L, e.file.length())
        rejects("LIMIT_EXCEEDED") { store.write(e.handle, 0, byteArrayOf()) }
    }
    @Test fun only_owned_handles_are_accepted_and_abort_never_deletes_destination() = fixture { store, root, _ ->
        val unrelated = java.io.File(root.parentFile, root.name + "-destination").apply { writeText("user document") }
        try {
            rejects("INVALID_HANDLE") { store.get(unrelated.path) }
            val e = store.begin("a", "text/plain", 0, "save")
            store.abort(e.handle)
            assertFalse(e.file.exists())
            assertFalse(e.live)
            assertEquals("user document", unrelated.readText())
        } finally { unrelated.delete() }
    }
    @Test fun stale_process_handles_and_expired_files_cannot_revive() = fixture { store, root, advance ->
        val e = store.begin("a", "text/plain", 0, "share")
        store.seal(e.handle)
        advance(ExportStore.TTL)
        rejects("HANDLE_EXPIRED") { store.get(e.handle) }
        assertFalse(e.file.exists())
        val fresh = store.begin("b", "text/plain", 0, "save")
        val restarted = ExportStore(root, { 0L })
        assertFalse(fresh.file.exists())
        rejects("INVALID_HANDLE") { restarted.get(fresh.handle) }
    }
    @Test fun malformed_metadata_never_becomes_a_path() = fixture { store, _, _ ->
        for (name in listOf("../escape", "a/b", "a\\b", "\u0000name", "")) {
            rejects("INVALID_REQUEST") { store.begin(name, "text/plain", 0, "save") }
        }
        rejects("INVALID_REQUEST") { store.begin("a", "*/*", 0, "save") }
        rejects("INVALID_REQUEST") { store.begin("a", "text/plain", 0, "other") }
    }
    @Test fun abort_all_revokes_sealed_share_and_pending_save_and_releases_capacity() = fixture { store, _, _ ->
        val share = store.begin("a", "text/plain", 0, "share")
        val save = store.begin("b", "text/plain", 0, "save")
        store.seal(share.handle)
        store.seal(save.handle)
        store.abortAll()
        for (e in listOf(share, save)) {
            assertFalse(e.file.exists())
            rejects("INVALID_HANDLE") { store.get(e.handle) }
        }
        store.begin("c", "text/plain", 0, "save")
    }
}
