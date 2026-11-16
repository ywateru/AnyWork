package dev.anywork.auth

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.net.Uri
import android.webkit.CookieManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.appcompat.app.AppCompatActivity
import com.google.gson.Gson
import io.logto.sdk.core.http.RefreshObservation
import io.logto.sdk.core.util.TokenUtils
import io.logto.sdk.android.LogtoClient
import io.logto.sdk.android.type.AccessToken
import io.logto.sdk.android.type.LogtoConfig
import io.logto.sdk.android.type.SignInOptions
import io.logto.sdk.android.exception.LogtoException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@InvokeArg
class ConfigureArgs {
    lateinit var endpoint: String
    lateinit var clientId: String
    lateinit var resource: String
    lateinit var redirectUri: String
    lateinit var product: String
    lateinit var issuer: String
    lateinit var gridUrl: String
}

@InvokeArg class SignInArgs { var register: Boolean = false }
@InvokeArg class GenerationArgs { var generation: Long = -1 }
@InvokeArg class TokenArgs {
    var generation: Long = -1
    var resource: Boolean = false
    var forceRefresh: Boolean = false
    var minValidity: Long = 30
}

/** Only the SDK owns grants. Its ordinary SharedPreferences storage is disabled. */
internal class RamClient(config: LogtoConfig, application: Application) : LogtoClient(config, application) {
    fun clearAccessCache() { accessTokenMap.clear() }
    fun restore(grant: SavedGrant) { clearAccessCache(); refreshToken = grant.refresh; idToken = grant.id }
    fun grant(): SavedGrant = SavedGrant(checkNotNull(refreshToken), checkNotNull(idToken), TokenUtils.decodeIdToken(checkNotNull(idToken)).sub)
    fun discard() { clearAccessCache(); refreshToken = null; idToken = null }
}

private class LoginCancelled : Exception()

/** A strong process owner survives WebView/Activity recreation. It never retains a
 * host Activity except during an explicit, cancellable interactive login. */
internal class AuthOwner(private val application: Application,
    private val bytes: (Application, String) -> GrantBytes = { app, binding -> AndroidGrantBytes(app, binding) },
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val operation get() = AuthLifecycle.operation
    private val generation = AtomicLong(0)
    private var configuration: ConfigureArgs? = null
    private var store: GrantStore? = null
    @Volatile private var expectedSubject: String? = null
    private var loginHost: Activity? = null
    private var journal: RefreshJournal? = null
    private var client: RamClient? = null
    private var status = "signedOut"
    private var logoutRequested = false
    private var profileValue: JSONObject? = null
    private var errorCode: String? = null
    private var preflight: AlertDialog? = null
    private var currentAttempt: AuthLifecycle.Attempt? = null
    private val gson = Gson()

    init {
        AuthLifecycle.install(application)
    }

    private fun jsonSnapshot() = JSObject().apply {
        put("generation", generation.get())
        put("status", status)
        put("profile", profileValue ?: JSONObject.NULL)
        put("errorCode", errorCode ?: JSONObject.NULL)
    }

    private fun requireOwner(expected: Long): RamClient {
        check(expected == generation.get() && status == "signedIn")
        return checkNotNull(client)
    }

    private fun invalidate(code: String) {
        val cleared = try { store?.clear(); true } catch (_: Exception) { false }
        client?.discard()
        expectedSubject = null
        generation.incrementAndGet()
        status = "reauthRequired"
        profileValue = null
        errorCode = if (cleared) code else "MOBILE_AUTH_STORAGE_UNAVAILABLE"
    }

    private fun sameConfiguration(a: ConfigureArgs, b: ConfigureArgs) =
        a.endpoint == b.endpoint && a.clientId == b.clientId && a.resource == b.resource &&
        a.redirectUri == b.redirectUri && a.product == b.product && a.issuer == b.issuer && a.gridUrl == b.gridUrl

    fun configure(invoke: Invoke) {
        val args = try { invoke.parseArgs(ConfigureArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_CONFIGURATION"); return }
        // Recreated business Activities need not wait for an existing SDK refresh.
        configuration?.let {
            if (!sameConfiguration(it, args)) invoke.reject("MOBILE_AUTH_CONFIGURATION")
            else invoke.resolve(jsonSnapshot())
            return
        }
        scope.launch {
            operation.withLock {
                try {
                    val resource = Uri.parse(args.resource)
                    check(args.endpoint == "https://auth.x.aixgg.com" && args.issuer == args.endpoint + "/oidc")
                    val grid = Uri.parse(args.gridUrl)
                    check(grid.scheme == "https" && grid.host != null && grid.userInfo == null && grid.query == null && grid.fragment == null)
                    check(resource.scheme == "https" && resource.host != null && resource.userInfo == null &&
                        resource.query == null && resource.fragment == null)
                    check(args.clientId.matches(Regex("[A-Za-z0-9_-]{1,21}")))
                    check(args.product.matches(Regex("[A-Za-z0-9_-]{1,128}")))
                    check(args.redirectUri == "http://127.0.0.1:17897/callback")
                    configuration?.let {
                        check(sameConfiguration(it, args))
                        invoke.resolve(jsonSnapshot()); return@withLock
                    }
                    configuration = args
                    val binding = org.json.JSONArray(listOf(args.endpoint, args.issuer, args.clientId, args.resource, args.gridUrl,
                        args.product, args.redirectUri, "openid offline_access profile email custom_data connect")).toString()
                    store = GrantStore(bytes(application, binding), binding)
                    client = RamClient(LogtoConfig(endpoint = args.endpoint, appId = args.clientId,
                        scopes = listOf("profile", "email", "custom_data", "connect"),
                        resources = listOf(args.resource), usingPersistStorage = false), application)
                    if (logoutRequested) {
                        // Logout can win the JNI race before initial configuration exists.
                        fence()
                    } else {
                        status = "restoring"
                        // Process-owned: dropping a guest invoke never cancels a rotation.
                        scope.launch { operation.withLock { if (status == "restoring") restoreSaved() } }
                    }
                    invoke.resolve(jsonSnapshot())
                } catch (_: Exception) { invoke.reject("MOBILE_AUTH_CONFIGURATION") }
            }
        }
    }

    private fun observe(sdk: RamClient) {
        journal = RefreshJournal(checkNotNull(store), checkNotNull(expectedSubject), sdk::grant)
        RefreshObservation.observer = journal
    }
    private fun persist() { checkNotNull(journal).commit() }
    private fun stopObserving() { RefreshObservation.observer = null; journal = null }
    private fun recoverableFailure() {
        // A received response which later failed SDK validation is still pending.
        val code = if (journal?.storageUnavailable == true) "MOBILE_AUTH_STORAGE_UNAVAILABLE" else "MOBILE_AUTH_RESTORE_UNAVAILABLE"
        if (journal?.pending == true) invalidate(if (journal?.storageUnavailable == true) code else "MOBILE_AUTH_REFRESH_UNCERTAIN")
        else { status = "restoreRetryable"; profileValue = null; errorCode = code }
    }
    private suspend fun acquire(sdk: RamClient, resource: String?): AccessToken = suspendCancellableCoroutine { continuation ->
        sdk.getAccessToken(resource) { exception, value ->
            if (continuation.isActive) {
                if (exception == null && value != null) continuation.resume(value)
                else continuation.resumeWithException(IllegalStateException("MOBILE_AUTH_REAUTH_REQUIRED"))
            }
        }
    }
    private suspend fun restoreSaved() {
        val sdk = checkNotNull(client)
        val owner = generation.incrementAndGet()
        try {
            val saved = checkNotNull(store).load()
            if (saved == null) { status = "signedOut"; errorCode = null; return }
            expectedSubject = saved.subject
            sdk.restore(saved)
            val storedClaims = try { readClaims(sdk) } catch (_: Exception) { throw InvalidGrantRecord() }
            if (storedClaims.optString("sub") != saved.subject) throw InvalidGrantRecord()
            observe(sdk)
            acquire(sdk, null) // No access token is persisted or required to restore.
            val profile = readProfile(sdk)
            check(profile.value.optString("subject") == saved.subject)
            check(generation.get() == owner)
            persist()
            status = "signedIn"; profileValue = profile.value
            errorCode = if (profile.unavailable) "MOBILE_PROFILE_UNAVAILABLE" else null
        } catch (_: InvalidGrantRecord) { if (generation.get() == owner) invalidate("MOBILE_AUTH_SAVED_GRANT_INVALID") }
        catch (_: GrantStorageUnavailable) {
            if (generation.get() == owner) {
                if (journal?.pending == true) invalidate("MOBILE_AUTH_STORAGE_UNAVAILABLE")
                else { status = "restoreRetryable"; profileValue = null; errorCode = "MOBILE_AUTH_STORAGE_UNAVAILABLE" }
            }
        } catch (_: Exception) { if (generation.get() == owner) recoverableFailure() }
        finally { stopObserving() }
    }
    fun restore(invoke: Invoke) {
        // Main-thread state change prevents duplicate retries while the SDK owns its lock.
        if (status == "restoreRetryable") {
            status = "restoring"; errorCode = null
            scope.launch { operation.withLock { if (status == "restoring") restoreSaved() } }
        }
        invoke.resolve(jsonSnapshot())
    }

    fun snapshot(invoke: Invoke) { invoke.resolve(jsonSnapshot()) }

    fun signIn(invoke: Invoke, host: Activity) {
        val args = try { invoke.parseArgs(SignInArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            if (!operation.tryLock()) { invoke.reject("MOBILE_AUTH_BUSY"); return@launch }
            if (status != "signedOut" || AuthLifecycle.active != null) { operation.unlock(); invoke.reject("MOBILE_AUTH_BUSY"); return@launch }
            loginHost = host
            var attempt: AuthLifecycle.Attempt? = null
            try {
                check(status == "signedOut")
                val sdk = checkNotNull(client)
                val config = checkNotNull(configuration)
                val owner = generation.incrementAndGet()
                attempt = AuthLifecycle.Attempt(owner)
                currentAttempt = attempt
                AuthLifecycle.active = attempt
                status = "authorizing"
                errorCode = null
                val accepted = suspendCancellableCoroutine<Boolean> { continuation ->
                    preflight = AlertDialog.Builder(host)
                        .setTitle("登录 AnyWork")
                        .setMessage("接下来在应用内打开登录服务：\nhttps://auth.x.aixgg.com\n\n请核对来源。登录页由 Logto SDK 提供，可用系统返回键取消。登录服务可能保留 SSO Cookie；应用将使用 Android 安全存储保存登录；退出账号会清除保存的授权。")
                        .setPositiveButton("继续") { _, _ -> if (continuation.isActive) continuation.resume(true) }
                        .setNegativeButton("取消") { _, _ -> if (continuation.isActive) continuation.resume(false) }
                        .setOnCancelListener { if (continuation.isActive) continuation.resume(false) }
                        .setOnDismissListener { if (continuation.isActive) continuation.resume(false) }
                        .show()
                }
                preflight = null
                if (!accepted || generation.get() != owner) throw LoginCancelled()
                suspendCancellableCoroutine<Unit> { continuation ->
                    sdk.signIn(host, SignInOptions(
                        redirectUri = config.redirectUri,
                        firstScreen = if (args.register) "register" else "signIn",
                    )) { exception ->
                        if (continuation.isActive) {
                            if (exception == null) continuation.resume(Unit)
                            else continuation.resumeWithException(if (exception.message == LogtoException.Type.USER_CANCELED.name) LoginCancelled() else IllegalStateException("MOBILE_AUTH_SIGN_IN"))
                        }
                    }
                }
                check(generation.get() == owner)
                expectedSubject = sdk.grant().subject
                observe(sdk)
                val profile = readProfile(sdk)
                check(generation.get() == owner)
                persist()
                status = "signedIn"
                profileValue = profile.value
                errorCode = if (profile.unavailable) "MOBILE_PROFILE_UNAVAILABLE" else null
            } catch (_: LoginCancelled) {
                if (attempt?.generation == generation.get()) {
                    generation.incrementAndGet()
                    status = "signedOut"
                    profileValue = null
                    errorCode = null
                }
            } catch (_: Exception) {
                // Do not reuse a grant after an exchange with an unknown outcome.
                if (attempt?.generation == generation.get()) invalidate("MOBILE_AUTH_SIGN_IN")
            } finally {
                // SDK onDestroy cancels its process-global auth session. No B
                // may start until A's callback AND every A Activity is destroyed.
                attempt?.let { it.cancel(); it.destroyed.await() }
                if (AuthLifecycle.active === attempt) AuthLifecycle.active = null
                if (currentAttempt === attempt) currentAttempt = null
                if (attempt?.cancelled == true && status == "signedOut") client?.discard()
                preflight = null
                loginHost = null
                stopObserving()
                operation.unlock()
            }
            invoke.resolve(jsonSnapshot())
        }
    }

    private suspend fun readClaims(sdk: RamClient): JSONObject {
        val claims = suspendCancellableCoroutine<JSONObject> { continuation ->
            sdk.getIdTokenClaims { exception, value ->
                if (continuation.isActive) {
                    if (exception == null && value != null) continuation.resume(JSONObject(gson.toJson(value)))
                    else continuation.resumeWithException(IllegalStateException("MOBILE_PROFILE_UNAVAILABLE"))
                }
            }
        }
        if (claims.optString("iss") != configuration!!.endpoint + "/oidc" ||
            claims.optString("aud") != configuration!!.clientId || claims.optString("sub").isBlank()) throw InvalidGrantRecord()
        return claims
    }

    private suspend fun readProfile(sdk: RamClient): ProfileResult =
        readSdkProfile(sdk, profileValue) { readClaims(sdk) }

    fun profile(invoke: Invoke) {
        val args = try { invoke.parseArgs(GenerationArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            operation.withLock {
                try {
                    val sdk = requireOwner(args.generation)
                    observe(sdk)
                    val value = readProfile(sdk)
                    requireOwner(args.generation)
                    check(profileValue?.optString("subject") == value.value.optString("subject"))
                    persist()
                    profileValue = value.value
                    errorCode = if (value.unavailable) "MOBILE_PROFILE_UNAVAILABLE" else null
                    invoke.resolve(jsonSnapshot())
                } catch (_: InvalidGrantRecord) {
                    if (generation.get() == args.generation) invalidate("MOBILE_AUTH_SAVED_GRANT_INVALID")
                    invoke.reject("MOBILE_PROFILE_UNAVAILABLE")
                } catch (_: Exception) {
                    if (generation.get() == args.generation) recoverableFailure()
                    invoke.reject("MOBILE_PROFILE_UNAVAILABLE")
                } finally { stopObserving() }
            }
        }
    }

    fun token(invoke: Invoke) {
        val args = try { invoke.parseArgs(TokenArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            operation.withLock {
                try {
                    check(args.minValidity in 1..3600)
                    val sdk = requireOwner(args.generation)
                    if (args.forceRefresh) sdk.clearAccessCache()
                    observe(sdk)
                    var grant = acquire(sdk, if (args.resource) configuration!!.resource else null)
                    requireOwner(args.generation)
                    if (grant.expiresAt - System.currentTimeMillis() / 1000 < args.minValidity && !args.forceRefresh) {
                        sdk.clearAccessCache()
                        grant = acquire(sdk, if (args.resource) configuration!!.resource else null)
                        requireOwner(args.generation)
                    }
                    check(grant.expiresAt - System.currentTimeMillis() / 1000 >= args.minValidity)
                    check(grant.token.isNotEmpty() && grant.token.length <= 16384)
                    check(grant.scope.split(Regex("\\s+")).contains(if (args.resource) "connect" else "custom_data"))
                    val claims = readClaims(sdk)
                    requireOwner(args.generation)
                    check(claims.optString("sub") == profileValue?.optString("subject"))
                    persist()
                    invoke.resolve(JSObject().apply {
                        put("accessToken", grant.token)
                        put("expiresAt", grant.expiresAt)
                        put("generation", generation.get())
                    })
                } catch (_: Exception) {
                    // Fence only this owner; a queued logout already fenced it.
                    if (generation.get() == args.generation) recoverableFailure()
                    invoke.reject("MOBILE_AUTH_REAUTH_REQUIRED")
                } finally { stopObserving() }
            }
        }
    }

    private fun fence() {
        // Fence immediately before waiting for a rotating SDK request to settle.
        generation.incrementAndGet()
        logoutRequested = true
        val cleared = try {
            val active = store
            if (active == null) bytes(application, "").erase() else active.clear()
            true
        } catch (_: Exception) { false }
        errorCode = if (cleared) null else "MOBILE_AUTH_CLEAR_REQUIRED"
        expectedSubject = null
        status = if (cleared) "signedOut" else "reauthRequired"
        profileValue = null
        preflight?.dismiss()
        currentAttempt?.cancel()
    }

    private suspend fun clearGrant() {
        val sdk = client
        // SDK signOut clears cookies only when authenticated. Explicit
        // logout also clears SSO cookies after a cancelled/failed login.
        CookieManager.getInstance().apply { removeAllCookies(null); flush() }
        if (sdk != null && sdk.isAuthenticated) {
            val revoked = suspendCancellableCoroutine<Boolean> { continuation ->
                sdk.signOut { exception ->
                    if (continuation.isActive) continuation.resume(exception == null)
                }
            }
            if (!revoked && errorCode != "MOBILE_AUTH_CLEAR_REQUIRED") errorCode = "MOBILE_REVOCATION_UNCONFIRMED"
        }
    }

    fun destroyed(activity: AppCompatActivity) {
        if (loginHost !== activity) return
        // Process-owned refresh/restore must settle and persist after Activity loss.
        if (status == "authorizing") {
            generation.incrementAndGet()
            status = "signedOut"; profileValue = null; errorCode = null
        }
        preflight?.dismiss()
        currentAttempt?.cancel()
    }

    fun logout(invoke: Invoke) {
        fence()
        scope.launch {
            operation.withLock {
                clearGrant()
                // SDK v2 clears local RAM even when revocation fails.
                invoke.resolve(jsonSnapshot())
            }
        }
    }
}

@TauriPlugin
class MobileAuthPlugin(private val host: Activity) : Plugin(host) {
    companion object {
        private var owner: AuthOwner? = null
        @Synchronized private fun process(application: Application): AuthOwner = owner ?: AuthOwner(application).also { owner = it }
    }
    private val auth = process(host.application)
    @Command fun configure(invoke: Invoke) = auth.configure(invoke)
    @Command fun snapshot(invoke: Invoke) = auth.snapshot(invoke)
    @Command fun restore(invoke: Invoke) = auth.restore(invoke)
    @Command fun signIn(invoke: Invoke) = auth.signIn(invoke, host)
    @Command fun profile(invoke: Invoke) = auth.profile(invoke)
    @Command fun token(invoke: Invoke) = auth.token(invoke)
    @Command fun logout(invoke: Invoke) = auth.logout(invoke)
    override fun onDestroy(activity: AppCompatActivity) = auth.destroyed(activity)
}
