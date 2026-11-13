package dev.remoteagent.app.system

import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

/** One bounded copy; cancellation also fences success after an in-flight provider write. */
internal class ExportCopy(private val live: () -> Boolean) {
    private val cancelled = AtomicBoolean()
    fun cancel(): Boolean = cancelled.compareAndSet(false, true)
    fun check() {
        if (cancelled.get() || !live()) throw SystemFailure("CANCELLED")
    }
    fun copy(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(ExportStore.MAX_CHUNK)
        while (true) {
            check()
            val count = input.read(buffer)
            check()
            if (count < 0) break
            output.write(buffer, 0, count)
            check()
        }
        output.flush()
        check()
    }
}
