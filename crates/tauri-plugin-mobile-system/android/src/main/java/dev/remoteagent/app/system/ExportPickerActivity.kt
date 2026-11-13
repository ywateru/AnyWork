package dev.remoteagent.app.system

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicLong

/** Owns only our save chooser so logout can close it without touching other activities. */
class ExportPickerActivity : Activity() {
    companion object {
        private val counter = AtomicLong()
        private var retired = 0L
        private var current: WeakReference<ExportPickerActivity>? = null
        fun nextGeneration(): Long = counter.incrementAndGet()
        // Called on UI thread. A late onCreate cannot reopen a cancelled picker.
        fun cancel(generation: Long) {
            retired = maxOf(retired, generation)
            current?.get()?.takeIf { it.generation <= retired }?.cancelPicker()
        }
    }
    private val requestCode = 18420
    private var generation = 0L
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        generation = intent.getLongExtra("generation", 0)
        current = WeakReference(this)
        if (state != null || generation <= retired) { cancelPicker(); return }
        try {
            val picker = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(intent.getStringExtra("mime"))
                .putExtra(Intent.EXTRA_TITLE, intent.getStringExtra("name"))
            @Suppress("DEPRECATION")
            startActivityForResult(picker, requestCode)
        } catch (_: Exception) {
            setResult(Activity.RESULT_FIRST_USER)
            finish()
        }
    }
    private fun cancelPicker() {
        @Suppress("DEPRECATION")
        finishActivity(requestCode)
        setResult(Activity.RESULT_CANCELED)
        finish()
    }
    @Deprecated("Activity result API retained to close precisely this owned child chooser")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == this.requestCode) {
            if (generation <= retired) setResult(Activity.RESULT_CANCELED)
            else setResult(resultCode, data)
            finish()
        }
    }
    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }
}
