package dev.anywork.auth

import android.app.Application
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class AuthOwnerTest {
    private class Bytes : GrantBytes {
        var content: ByteArray? = null
        var fail = false
        var reads = 0
        override fun read(): ByteArray? { reads++; return content }
        override fun write(value: ByteArray) { if (fail) throw java.io.IOException(); content = value.clone() }
        override fun erase() { if (fail) throw java.io.IOException(); content = null }
    }
    private fun call(args: String = "{}", action: (Invoke) -> Unit): JSONObject {
        var result: JSONObject? = null
        action(Invoke(1, "fixture", 1, 2, { callback, json ->
            assertEquals("native invoke rejected", 1L, callback)
            result = JSONObject(json)
        }, args, ObjectMapper()))
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        return checkNotNull(result)
    }
    private fun configure(owner: AuthOwner) = call(JSONObject().apply {
        put("endpoint", "https://auth.x.aixgg.com"); put("issuer", "https://auth.x.aixgg.com/oidc")
        put("clientId", "fixture-client"); put("product", "fixture-product")
        put("gridUrl", "https://gateway.example.invalid"); put("resource", "https://resource.example.invalid")
        put("redirectUri", "http://127.0.0.1:17897/callback")
    }.toString(), owner::configure)
    @Test fun recreatedHostConfigureReturnsSnapshotWithoutWaitingForSdkOperation() {
        val owner = AuthOwner(RuntimeEnvironment.getApplication()) { _, _ -> Bytes() }
        configure(owner)
        assertTrue(AuthLifecycle.operation.tryLock())
        try { assertEquals("signedOut", configure(owner).getString("status")) }
        finally { AuthLifecycle.operation.unlock() }
    }
    @Test fun logoutBeforeInitialConfigureClearsSavedGrantInsteadOfRestoringIt() {
        val bytes = Bytes().apply { content = "old saved grant must not be adopted".toByteArray() }
        val owner = AuthOwner(RuntimeEnvironment.getApplication()) { _, _ -> bytes }
        assertEquals("signedOut", call(action = owner::logout).getString("status"))
        assertNull(bytes.content) // Already durable even if process dies before configure.
        assertEquals("signedOut", configure(owner).getString("status"))
        assertEquals(0, bytes.reads)
        assertEquals("loggedOut", JSONObject(String(bytes.content!!)).getString("mode"))
    }
    @Test fun failedDurableLogoutDoesNotClaimSignedOutOrAllowRestoreAndCanRetryClear() {
        val bytes = Bytes(); val owner = AuthOwner(RuntimeEnvironment.getApplication()) { _, _ -> bytes }
        assertEquals("restoring", configure(owner).getString("status"))
        assertEquals("signedOut", call(action = owner::snapshot).getString("status"))
        bytes.fail = true
        val blocked = call(action = owner::logout)
        assertEquals("reauthRequired", blocked.getString("status"))
        assertEquals("MOBILE_AUTH_CLEAR_REQUIRED", blocked.getString("errorCode"))
        val reads = bytes.reads
        assertEquals("reauthRequired", call(action = owner::restore).getString("status"))
        assertEquals(reads, bytes.reads) // no adoption of uncleared grant, no SSO or refresh.
        bytes.fail = false
        val cleared = call(action = owner::logout)
        assertEquals("signedOut", cleared.getString("status"))
        assertTrue(cleared.isNull("errorCode"))
        assertEquals("loggedOut", JSONObject(String(bytes.content!!)).getString("mode"))
    }
}
