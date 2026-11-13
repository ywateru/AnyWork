package dev.anywork.auth

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import io.logto.sdk.android.auth.logto.LogtoWebViewAuthActivity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import java.lang.ref.WeakReference

/** A public Android lifecycle barrier, not access to SDK private AuthManager.
 * Initialized before restored Activities, so an orphan login never resumes
 * without its in-memory PKCE/grant owner. All access occurs on the main thread.
 */
internal object AuthLifecycle {
    val operation = Mutex()
    class Attempt(val generation: Long) {
        var cancelled = false
        var recreating = false
        val activities = mutableSetOf<Activity>()
        var destroyed = CompletableDeferred<Unit>().apply { complete(Unit) }
        fun cancel() { cancelled = true; activities.toList().forEach { it.finish() } }
    }
    var active: Attempt? = null
    private var installed = WeakReference<Application>(null)

    fun install(application: Application) {
        if (installed.get() === application) return
        installed = WeakReference(application)
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, state: Bundle?) {
                if (activity !is LogtoWebViewAuthActivity) return
                val attempt = active
                if (attempt == null) { activity.finish(); return }
                if (attempt.activities.isEmpty() && !attempt.recreating) attempt.destroyed = CompletableDeferred()
                attempt.recreating = false
                attempt.activities.add(activity)
                if (attempt.cancelled) activity.finish()
            }
            override fun onActivityDestroyed(activity: Activity) {
                val attempt = active ?: return
                if (!attempt.activities.remove(activity)) return
                if (activity.isChangingConfigurations) attempt.recreating = true
                if (attempt.activities.isEmpty() && !attempt.recreating) attempt.destroyed.complete(Unit)
            }
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
        })
    }
}

/** Manifest initializer runs even when Android restores the SDK Activity first. */
class AuthLifecycleInitializer : ContentProvider() {
    override fun onCreate(): Boolean {
        AuthLifecycle.install(context!!.applicationContext as Application)
        return true
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
