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
private class RamClient(config: LogtoConfig, application: Application) : LogtoClient(config, application) {
    fun clearAccessCache() { accessTokenMap.clear() }
}

private class LoginCancelled : Exception()

@TauriPlugin
class MobileAuthPlugin(private val host: Activity) : Plugin(host) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val operation get() = AuthLifecycle.operation
    private val generation = AtomicLong(0)
    private var configuration: ConfigureArgs? = null
    private var client: RamClient? = null
    private var status = "signedOut"
    private var profileValue: JSONObject? = null
    private var errorCode: String? = null
    private var preflight: AlertDialog? = null
    private var currentAttempt: AuthLifecycle.Attempt? = null
    private val gson = Gson()

    init {
        AuthLifecycle.install(host.application)
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
        generation.incrementAndGet()
        status = "reauthRequired"
        profileValue = null
        errorCode = code
    }

    @Command
    fun configure(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ConfigureArgs::class.java)
            val endpoint = Uri.parse(args.endpoint)
            val resource = Uri.parse(args.resource)
            val redirect = Uri.parse(args.redirectUri)
            check(endpoint.scheme == "https" && endpoint.host != null && endpoint.userInfo == null &&
                endpoint.query == null && endpoint.fragment == null && endpoint.path.isNullOrEmpty() &&
                args.endpoint == "https://auth.x.aixgg.com")
            check(resource.scheme == "https" && resource.host != null && resource.userInfo == null &&
                resource.query == null && resource.fragment == null)
            check(args.clientId.matches(Regex("[A-Za-z0-9_-]{1,21}")))
            check(redirect.scheme == "http" && redirect.host == "127.0.0.1" &&
                redirect.path == "/callback" && redirect.query == null && redirect.fragment == null &&
                redirect.userInfo == null && redirect.port == 17897 &&
                args.redirectUri == "http://127.0.0.1:17897/callback")
            configuration?.let {
                check(it.endpoint == args.endpoint && it.clientId == args.clientId &&
                    it.resource == args.resource && it.redirectUri == args.redirectUri)
                invoke.resolve(jsonSnapshot())
                return
            }
            configuration = args
            client = RamClient(LogtoConfig(
                endpoint = args.endpoint,
                appId = args.clientId,
                scopes = listOf("profile", "email", "custom_data", "connect"),
                resources = listOf(args.resource),
                usingPersistStorage = false,
            ), host.application)
            invoke.resolve(jsonSnapshot())
        } catch (_: Exception) { invoke.reject("MOBILE_AUTH_CONFIGURATION") }
    }

    @Command fun snapshot(invoke: Invoke) { invoke.resolve(jsonSnapshot()) }

    @Command
    fun signIn(invoke: Invoke) {
        val args = try { invoke.parseArgs(SignInArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            if (!operation.tryLock()) { invoke.reject("MOBILE_AUTH_BUSY"); return@launch }
            if (status != "signedOut" || AuthLifecycle.active != null) { operation.unlock(); invoke.reject("MOBILE_AUTH_BUSY"); return@launch }
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
                        .setMessage("接下来在应用内打开登录服务：\nhttps://auth.x.aixgg.com\n\n请核对来源。登录页由 Logto SDK 提供，可用系统返回键取消。登录服务可能保留 SSO Cookie；应用授权令牌只保留在内存。")
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
                status = "signedIn"
                profileValue = readProfile(sdk)
                check(generation.get() == owner)
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
                preflight = null
                operation.unlock()
            }
            invoke.resolve(jsonSnapshot())
        }
    }

    private suspend fun readProfile(sdk: RamClient): JSONObject {
        val claims = suspendCancellableCoroutine<JSONObject> { continuation ->
            sdk.getIdTokenClaims { exception, value ->
                if (continuation.isActive) {
                    if (exception == null && value != null) continuation.resume(JSONObject(gson.toJson(value)))
                    else continuation.resumeWithException(IllegalStateException("MOBILE_PROFILE_UNAVAILABLE"))
                }
            }
        }
        val subject = claims.optString("sub")
        check(subject.isNotBlank() && subject.length <= 128)
        val info = suspendCancellableCoroutine<JSONObject> { continuation ->
            sdk.fetchUserInfo { exception, value ->
                if (continuation.isActive) {
                    if (exception == null && value != null) continuation.resume(JSONObject(gson.toJson(value)))
                    else continuation.resumeWithException(IllegalStateException("MOBILE_PROFILE_UNAVAILABLE"))
                }
            }
        }
        check(info.optString("sub") == subject)
        fun text(key: String): String? = listOf(info, claims).firstNotNullOfOrNull { data ->
            (data.opt(key) as? String)?.trim()?.takeIf { value ->
                value.isNotEmpty() && value.length <= 160 && value.none { it.isISOControl() }
            }
        }
        val username = text("username") ?: text("preferred_username")
        val email = text("email")
        return JSONObject().apply {
            put("subject", subject)
            put("displayName", text("name") ?: username ?: email ?: "已登录账号")
            put("username", username ?: JSONObject.NULL)
            put("email", email ?: JSONObject.NULL)
            val picture = text("picture")?.takeIf { Uri.parse(it).scheme == "https" }
            put("picture", picture ?: JSONObject.NULL)
        }
    }

    @Command
    fun profile(invoke: Invoke) {
        val args = try { invoke.parseArgs(GenerationArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            operation.withLock {
                try {
                    val sdk = requireOwner(args.generation)
                    val value = readProfile(sdk)
                    requireOwner(args.generation)
                    check(profileValue?.optString("subject") == value.optString("subject"))
                    profileValue = value
                    errorCode = null
                    invoke.resolve(jsonSnapshot())
                } catch (_: Exception) {
                    if (generation.get() == args.generation) invalidate("MOBILE_AUTH_REAUTH_REQUIRED")
                    invoke.reject("MOBILE_PROFILE_UNAVAILABLE")
                }
            }
        }
    }

    @Command
    fun token(invoke: Invoke) {
        val args = try { invoke.parseArgs(TokenArgs::class.java) }
        catch (_: Exception) { invoke.reject("MOBILE_AUTH_INPUT"); return }
        scope.launch {
            operation.withLock {
                try {
                    check(args.minValidity in 1..3600)
                    val sdk = requireOwner(args.generation)
                    if (args.forceRefresh) sdk.clearAccessCache()
                    suspend fun acquire(): AccessToken = suspendCancellableCoroutine { continuation ->
                        sdk.getAccessToken(if (args.resource) configuration!!.resource else null) { exception, value ->
                            if (continuation.isActive) {
                                if (exception == null && value != null) continuation.resume(value)
                                else continuation.resumeWithException(IllegalStateException("MOBILE_AUTH_REAUTH_REQUIRED"))
                            }
                        }
                    }
                    var grant = acquire()
                    requireOwner(args.generation)
                    if (grant.expiresAt - System.currentTimeMillis() / 1000 < args.minValidity && !args.forceRefresh) {
                        sdk.clearAccessCache()
                        grant = acquire()
                        requireOwner(args.generation)
                    }
                    check(grant.expiresAt - System.currentTimeMillis() / 1000 >= args.minValidity)
                    check(grant.token.isNotEmpty() && grant.token.length <= 16384)
                    check(grant.scope.split(Regex("\\s+")).contains(if (args.resource) "connect" else "custom_data"))
                    invoke.resolve(JSObject().apply {
                        put("accessToken", grant.token)
                        put("expiresAt", grant.expiresAt)
                        put("generation", generation.get())
                    })
                } catch (_: Exception) {
                    // Fence only this owner; a queued logout already fenced it.
                    if (generation.get() == args.generation) invalidate("MOBILE_AUTH_REAUTH_REQUIRED")
                    invoke.reject("MOBILE_AUTH_REAUTH_REQUIRED")
                }
            }
        }
    }

    private fun fence() {
        // Fence immediately before waiting for a rotating SDK request to settle.
        generation.incrementAndGet()
        status = "signedOut"
        profileValue = null
        errorCode = null
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
            if (!revoked) errorCode = "MOBILE_REVOCATION_UNCONFIRMED"
        }
    }

    override fun onDestroy(activity: AppCompatActivity) {
        if (activity !== host) return
        fence()
        // Complete any already dispatched rotation before discarding its grant.
        scope.launch { operation.withLock { clearGrant() } }
    }

    @Command
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
