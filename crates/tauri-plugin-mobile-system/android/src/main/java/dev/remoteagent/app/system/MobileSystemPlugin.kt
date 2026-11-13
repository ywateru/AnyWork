package dev.remoteagent.app.system

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.util.Base64
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@InvokeArg
class SubscribeArgs { lateinit var channel: Channel }

@TauriPlugin
class MobileSystemPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    // At most one active save is admitted. Provider I/O must not block cancellation/store retirement.
    private val copyWorker = Executors.newSingleThreadExecutor()
    private val copyCleanup = Executors.newSingleThreadExecutor()
    private class SaveCopy(val handle: String, val entry: ExportStore.Entry) {
        val copy = ExportCopy { entry.live }
        val signal = CancellationSignal()
        val descriptor = AtomicReference<ParcelFileDescriptor?>()
    }
    private var activeCopy: SaveCopy? = null // worker-only; retained until provider I/O actually exits
    private var destroyed = false // worker-only
    private val store = ExportStore(File(activity.cacheDir, "anywork-exports"), SystemClock::elapsedRealtime) { entry ->
        if (entry.purpose == "share") {
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.mobile-system.exports", entry.file, entry.name)
                activity.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: Exception) { /* File deletion still revokes future access. */ }
        }
    }
    @Volatile private var events: Channel? = null
    @Volatile private var canGoBack = false
    @Volatile private var blocking = false
    @Volatile private var revision = 0L
    private var businessView: WebView? = null
    private var appearanceDark: Boolean? = null // main-thread-only; follows the actual business UI theme
    private var pendingSave: Pair<Invoke, String>? = null // worker-only
    private var pickerGeneration = 0L
    private var backEventId = 0L
    private var pendingBack: Pair<Long, Long>? = null // main-thread-only
    private val shareRequestCode = 18421
    private var backCallback: OnBackPressedCallback? = null

    init {
        worker.scheduleAtFixedRate({
            pendingSave?.let { (invoke, handle) ->
                try { store.get(handle) } catch (_: Exception) {
                    cancelPending(handle, "HANDLE_EXPIRED")
                }
            }
            store.sweep()
        }, 1, 1, TimeUnit.MINUTES)
    }
    private fun emit(event: String, payload: JSObject) {
        events?.send(JSObject().put("event", event).put("payload", payload))
    }
    private fun ui(invoke: Invoke, block: () -> Unit) {
        activity.runOnUiThread {
            try { block() } catch (_: Exception) { invoke.reject("System operation failed", "SYSTEM_FAILED") }
        }
    }
    private fun io(invoke: Invoke, block: () -> Unit) {
        worker.execute {
            try { block() }
            catch (e: SystemFailure) { invoke.reject("System operation failed", e.code) }
            catch (_: Exception) { invoke.reject("System operation failed", "SYSTEM_FAILED") }
        }
    }
    override fun load(webView: WebView) {
        businessView = webView
        activity.runOnUiThread {
            // JS applies insets exactly once. Tauri edge-to-edge root stays unpadded.
            ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
                revision++
                emit("mobile-system-insets", insets(insets))
                insets
            }
            webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                revision++
                emit("mobile-system-insets", insets())
            }
            ViewCompat.requestApplyInsets(webView)
            val host = activity as AppCompatActivity
            backCallback = object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val insets = ViewCompat.getRootWindowInsets(webView)
                    if (insets?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                        WindowInsetsControllerCompat(activity.window, webView).hide(WindowInsetsCompat.Type.ime())
                    } else if (pendingBack?.let { SystemClock.elapsedRealtime() - it.second >= 1500 } == true) {
                        // A second physical press after JS stopped responding hands control to Android.
                        activity.finishAfterTransition()
                    } else if (pendingBack != null) {
                        return
                    } else if (canGoBack || blocking) {
                        revision++
                        backEventId++
                        pendingBack = backEventId to SystemClock.elapsedRealtime()
                        emit("mobile-system-back", JSObject().put("eventId", backEventId).put("revision", revision))
                    } else {
                        // Bypass Tauri's URL-history callback: root means system back.
                        activity.finishAfterTransition()
                    }
                }
            }.also { host.onBackPressedDispatcher.addCallback(host, it) }
        }
    }
    private fun insets(value: WindowInsetsCompat? = businessView?.let { ViewCompat.getRootWindowInsets(it) }): JSObject {
        // WebView scale is screen pixels per CSS pixel, including viewport/page scale.
        @Suppress("DEPRECATION")
        val scale = businessView?.scale?.toDouble()?.takeIf { it > 0 }
            ?: activity.resources.displayMetrics.density.toDouble()
        fun edges(type: Int): JSObject {
            val edge = value?.getInsets(type)
            return JSObject().put("top", (edge?.top ?: 0) / scale)
                .put("right", (edge?.right ?: 0) / scale)
                .put("bottom", (edge?.bottom ?: 0) / scale)
                .put("left", (edge?.left ?: 0) / scale)
        }
        return JSObject().put("unit", "cssPx").put("systemBars", edges(WindowInsetsCompat.Type.systemBars()))
            .put("cutout", edges(WindowInsetsCompat.Type.displayCutout()))
            .put("ime", edges(WindowInsetsCompat.Type.ime()))
            .put("imeVisible", value?.isVisible(WindowInsetsCompat.Type.ime()) == true)
            .put("revision", revision)
    }
    @Command fun subscribe(invoke: Invoke) = ui(invoke) {
        events = invoke.parseArgs(SubscribeArgs::class.java).channel
        emit("mobile-system-insets", insets())
        invoke.resolve()
    }
    @Command fun insetsGet(invoke: Invoke) = ui(invoke) { invoke.resolve(insets()) }
    private fun applyAppearance() {
        val dark = appearanceDark ?: return
        val view = businessView ?: return
        WindowInsetsControllerCompat(activity.window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
    @Command fun appearanceSet(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs()
        if (!args.has("dark") || args.get("dark") !is Boolean) {
            invoke.reject("Invalid appearance", "INVALID_REQUEST")
            return@ui
        }
        appearanceDark = args.getBoolean("dark")
        applyAppearance()
        invoke.resolve(JSObject().put("dark", appearanceDark))
    }
    @Command fun backSetState(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs()
        if (args.has("handledEventId") && !args.isNull("handledEventId")) {
            val acknowledged = args.getLong("handledEventId")
            if (pendingBack?.first != acknowledged) { invoke.resolve(); return@ui }
            pendingBack = null
        }
        canGoBack = args.getBoolean("canGoBack")
        blocking = args.getBoolean("blocking")
        invoke.resolve()
    }
    @Command fun openExternal(invoke: Invoke) = ui(invoke) {
        val url = invoke.getArgs().getString("url")
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || url.any { it.code < 32 }) {
            invoke.reject("Only HTTPS links are allowed", "INVALID_REQUEST")
        } else {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
            invoke.resolve()
        }
    }
    @Command fun exportBegin(invoke: Invoke) = io(invoke) {
        val args = invoke.getArgs()
        val e = store.begin(args.getString("name"), args.getString("mime"), args.getLong("expectedBytes"), args.getString("purpose"))
        invoke.resolve(JSObject().put("handle", e.handle))
    }
    @Command fun exportWrite(invoke: Invoke) = io(invoke) {
        val args = invoke.getArgs()
        val encoded = args.getString("base64")
        if (encoded.length > 4 * ((ExportStore.MAX_CHUNK + 2) / 3) ||
            !encoded.matches(Regex("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?"))) throw SystemFailure("INVALID_REQUEST")
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val received = store.write(args.getString("handle"), args.getLong("sequence"), bytes)
        invoke.resolve(JSObject().put("received", received))
    }
    @Command fun exportAbort(invoke: Invoke) = io(invoke) {
        val handle = invoke.getArgs().getString("handle")
        cancelPending(handle)
        store.abort(handle)
        invoke.resolve()
    }
    private fun cancelPending(handle: String? = null, code: String = "CANCELLED") {
        activeCopy?.takeIf { handle == null || handle == it.handle }?.let { job ->
            if (job.copy.cancel()) copyCleanup.execute {
                // A provider may ignore cancellation; neither signal nor close can block the control worker.
                try { job.signal.cancel() } catch (_: Exception) { }
                try { job.descriptor.getAndSet(null)?.close() } catch (_: Exception) { }
            }
        }
        pendingSave?.let { (invoke, pending) ->
            if (handle == null || handle == pending) {
                pendingSave = null
                val generation = pickerGeneration
                activity.runOnUiThread { ExportPickerActivity.cancel(generation) }
                invoke.reject("Export aborted", code)
            }
        }
    }
    @Command fun abortAll(invoke: Invoke) = io(invoke) {
        cancelPending()
        store.abortAll()
        activity.runOnUiThread { activity.finishActivity(shareRequestCode) }
        invoke.resolve()
    }
    @Command fun exportFinish(invoke: Invoke) = io(invoke) {
        val handle = invoke.getArgs().getString("handle")
        if (pendingSave != null || activeCopy != null) throw SystemFailure("SYSTEM_BUSY")
        val e = store.seal(handle)
        if (e.purpose == "save") {
            pendingSave = invoke to handle
            pickerGeneration = ExportPickerActivity.nextGeneration()
            val generation = pickerGeneration
            activity.runOnUiThread {
                try {
                    if (!e.live) return@runOnUiThread
                    val intent = Intent(activity, ExportPickerActivity::class.java)
                        .putExtra("mime", e.mime).putExtra("name", e.name).putExtra("generation", generation)
                    startActivityForResult(invoke, intent, "saveResult")
                } catch (_: Exception) {
                    worker.execute { pendingSave = null; store.abort(handle); invoke.reject("Cannot open save picker", "SYSTEM_FAILED") }
                }
            }
        } else {
            // URI's visible name is supplied by FileProvider; the path never crosses IPC.
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.mobile-system.exports", e.file, e.name)
            val send = Intent(Intent.ACTION_SEND).setType(e.mime).putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            send.clipData = ClipData.newUri(activity.contentResolver, e.name, uri)
            activity.runOnUiThread {
                try {
                    if (!e.live) return@runOnUiThread
                    @Suppress("DEPRECATION")
                    activity.startActivityForResult(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), shareRequestCode)
                    invoke.resolve(JSObject().put("status", "chooserOpened"))
                } catch (_: Exception) {
                    worker.execute { store.abort(handle); invoke.reject("Cannot open share chooser", "SYSTEM_FAILED") }
                }
            }
            // Keep the temporary grant/file alive only until the process TTL or logout.
        }
    }
    @ActivityCallback fun saveResult(invoke: Invoke, result: ActivityResult) = io(invoke) {
        val pending = pendingSave
        if (pending == null || pending.first.id != invoke.id) return@io
        val handle = pending.second
        var copying = false
        try {
            val entry = store.get(handle)
            if (result.resultCode == Activity.RESULT_CANCELED) {
                invoke.resolve(JSObject().put("status", "cancelled"))
            } else if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
                throw SystemFailure("SYSTEM_FAILED")
            } else {
                val uri = result.data!!.data!!
                if (uri.scheme != "content") throw SystemFailure("INVALID_DESTINATION")
                val job = SaveCopy(handle, entry)
                activeCopy = job
                copyWorker.execute {
                    val failure = try {
                        job.copy.check()
                        val descriptor = activity.contentResolver.openFileDescriptor(uri, "wt", job.signal)
                            ?: throw SystemFailure("SYSTEM_FAILED")
                        job.descriptor.set(descriptor)
                        ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { output ->
                            job.copy.check()
                            entry.file.inputStream().use { job.copy.copy(it, output) }
                        }
                        job.copy.check()
                        null
                    } catch (error: Exception) {
                        if (!entry.live) "CANCELLED" else (error as? SystemFailure)?.code ?: "SYSTEM_FAILED"
                    } finally {
                        try { job.descriptor.getAndSet(null)?.close() } catch (_: Exception) { }
                    }
                    worker.execute {
                        if (activeCopy === job) activeCopy = null
                        // Abort/logout already rejected and removed this invoke. Never settle it again.
                        if (pendingSave?.first?.id == invoke.id) {
                            pendingSave = null
                            if (failure == null && entry.live) invoke.resolve(JSObject().put("status", "saved"))
                            else invoke.reject("Export failed", failure ?: "CANCELLED")
                        }
                        store.abort(handle)
                        if (destroyed) worker.shutdown()
                    }
                }
                copying = true
            }
        } finally {
            if (!copying) {
                pendingSave = null
                store.abort(handle) // Never delete the user's destination, including partial output.
            }
        }
    }
    override fun onResume(activity: AppCompatActivity) {
        applyAppearance()
        revision++
        emit("mobile-system-lifecycle", JSObject().put("foreground", true).put("revision", revision))
    }
    override fun onPause(activity: AppCompatActivity) {
        revision++
        emit("mobile-system-lifecycle", JSObject().put("foreground", false).put("revision", revision))
    }
    override fun onDestroy(activity: AppCompatActivity) {
        events = null
        backCallback?.remove()
        worker.execute {
            destroyed = true
            cancelPending()
            store.abortAll()
            copyWorker.shutdown()
            copyCleanup.shutdown()
            if (activeCopy == null) worker.shutdown()
        }
    }
}
