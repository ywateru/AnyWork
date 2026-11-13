package dev.remoteagent.app.system

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ExportCopyTest {
    private fun cancelled(action: () -> Unit) {
        try { action(); fail("Expected cancellation") }
        catch (error: SystemFailure) { assertEquals("CANCELLED", error.code) }
    }
    @Test fun normal_copy_preserves_multiple_chunks() {
        val data = ByteArray(ExportStore.MAX_CHUNK * 2 + 3) { (it % 251).toByte() }
        val output = ByteArrayOutputStream()
        ExportCopy { true }.copy(ByteArrayInputStream(data), output)
        assertArrayEquals(data, output.toByteArray())
    }
    @Test fun blocked_first_write_does_not_block_cancellation_or_start_second_chunk() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val writes = AtomicInteger()
        val copier = ExportCopy { true }
        val executor = Executors.newSingleThreadExecutor()
        val output = object : OutputStream() {
            override fun write(value: Int) = error("Must use bounded chunks")
            override fun write(bytes: ByteArray, offset: Int, count: Int) {
                assertTrue(count <= ExportStore.MAX_CHUNK)
                writes.incrementAndGet()
                entered.countDown()
                assertTrue(release.await(3, TimeUnit.SECONDS))
            }
            override fun flush() = fail("Cancelled copy must not flush or settle saved")
        }
        try {
            val result = executor.submit<Boolean> {
                cancelled { copier.copy(ByteArrayInputStream(ByteArray(ExportStore.MAX_CHUNK * 2)), output) }
                true
            }
            assertTrue(entered.await(3, TimeUnit.SECONDS))
            // Runs independently of the blocked provider thread; cancellation never waits for its close.
            assertTrue(copier.cancel())
            assertFalse(copier.cancel())
            release.countDown()
            assertTrue(result.get(3, TimeUnit.SECONDS))
            assertEquals(1, writes.get())
        } finally { release.countDown(); executor.shutdownNow() }
    }
    @Test fun retirement_between_read_and_write_prevents_destination_write() {
        var live = true
        val input = object : ByteArrayInputStream(byteArrayOf(1)) {
            override fun read(bytes: ByteArray, offset: Int, count: Int): Int {
                val result = super.read(bytes, offset, count)
                live = false
                return result
            }
        }
        val output = ByteArrayOutputStream()
        cancelled { ExportCopy { live }.copy(input, output) }
        assertEquals(0, output.size())
    }
    @Test fun retirement_during_flush_cannot_return_success() {
        var live = true
        val output = object : ByteArrayOutputStream() {
            override fun flush() { live = false }
        }
        cancelled { ExportCopy { live }.copy(ByteArrayInputStream(byteArrayOf(1)), output) }
        assertArrayEquals(byteArrayOf(1), output.toByteArray()) // Partial target is retained, never deleted.
    }
}
