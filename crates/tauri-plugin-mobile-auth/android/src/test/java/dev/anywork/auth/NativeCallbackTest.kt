package dev.anywork.auth

import android.app.Activity
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import io.logto.sdk.android.auth.logto.LogtoAuthSession
import io.logto.sdk.android.auth.logto.LogtoWebViewAuthClient
import io.logto.sdk.android.exception.LogtoException
import io.logto.sdk.android.type.LogtoConfig
import io.logto.sdk.android.type.SignInOptions
import io.logto.sdk.core.type.OidcConfigResponse
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Calls the actual SDK callback matcher. Missing state fails before token HTTP.
 * It does not create a loopback listener, contact Logto, or claim a valid login.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeCallbackTest {
    private fun request(value: String) = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(value)
        override fun isForMainFrame() = true
        override fun isRedirect() = false
        override fun hasGesture() = true
        override fun getMethod() = "GET"
        override fun getRequestHeaders() = mutableMapOf<String, String>()
    }

    @Test fun existingNativeLoopbackUriIsInterceptedWithStateCheckAndNoListener() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val host = controller.get()
        val base = "https://auth.example.invalid/oidc"
        var result: LogtoException? = null
        var completed = false
        LogtoAuthSession(
            host,
            LogtoConfig(endpoint = "https://auth.example.invalid", appId = "fixture-native", usingPersistStorage = false),
            OidcConfigResponse("$base/auth", "$base/token", "$base/session/end", "$base/me", "$base/jwks", base, "$base/token/revocation"),
            SignInOptions(redirectUri = "http://127.0.0.1:17897/callback"),
        ) { exception, _ -> completed = true; result = exception }.start()

        val client = LogtoWebViewAuthClient(host, "")
        val view = WebView(host)
        assertFalse(client.shouldOverrideUrlLoading(view, request("http://127.0.0.1:17898/callback?code=fixture")))
        assertFalse(client.shouldOverrideUrlLoading(view, request("http://127.0.0.1:17897/wrong?code=fixture")))
        assertFalse(client.shouldOverrideUrlLoading(view, request("http://127.0.0.1:17897/callback#fragment")))
        assertFalse(completed)
        assertTrue(client.shouldOverrideUrlLoading(view, request("http://127.0.0.1:17897/callback?code=fixture")))
        assertTrue(completed)
        assertEquals(LogtoException.Type.INVALID_CALLBACK_URI.name, result?.message)
        assertTrue(host.isFinishing)
        assertFalse(client.shouldOverrideUrlLoading(view, request("http://127.0.0.1:17897/callback?code=fixture")))
        view.destroy()
        controller.pause().stop().destroy()
    }
}
