package dev.anywork.auth

import android.app.Application
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import io.logto.sdk.android.type.LogtoConfig
import io.logto.sdk.core.http.RefreshObservation
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.jose4j.jwk.RsaJwkGenerator
import org.jose4j.jws.JsonWebSignature
import org.jose4j.jws.AlgorithmIdentifiers
import org.jose4j.jwt.JwtClaims
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real official Android AAR + vendor JVM transport, synthetic IdP on loopback.
 * Does not access a production key, grant, cookie, account, or Android device. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SdkGrantRestoreTest {
    private class Bytes : GrantBytes {
        var value: ByteArray? = null
        override fun read() = value
        override fun write(value: ByteArray) { this.value = value.clone() }
        override fun erase() { value = null }
    }
    @After fun resetObserver() { RefreshObservation.observer = null }
    private fun client(endpoint: String) = RamClient(LogtoConfig(endpoint = endpoint, appId = "fixture-client",
        scopes = listOf("profile", "email", "custom_data", "connect"), resources = listOf("https://resource.invalid"),
        usingPersistStorage = false), RuntimeEnvironment.getApplication())
    private fun refresh(sdk: RamClient): Exception? {
        val done = CountDownLatch(1); val failure = AtomicReference<Exception?>()
        sdk.getAccessToken { error, _ -> failure.set(error); done.countDown() }
        assertTrue("SDK callback bounded", done.await(10, TimeUnit.SECONDS))
        return failure.get()
    }
    private fun fixture(mode: String = "success", run: (MockWebServer, SavedGrant) -> Unit) {
        MockWebServer().use { server ->
            server.start()
            val key = RsaJwkGenerator.generateJwk(2048).apply { keyId = "fixture-key" }
            val issuer = server.url("/oidc").toString()
            fun token(subject: String) = JsonWebSignature().apply {
                payload = JwtClaims().apply {
                    setIssuer(issuer); setAudience("fixture-client"); setSubject(subject)
                    setIssuedAtToNow(); setExpirationTimeMinutesInTheFuture(10f)
                }.toJson()
                algorithmHeaderValue = AlgorithmIdentifiers.RSA_USING_SHA256
                keyIdHeaderValue = key.keyId; this.key = key.privateKey
            }.compactSerialization
            val original = SavedGrant("fixture-old-refresh", token("fixture-subject"), "fixture-subject")
            val refusedPort = java.net.ServerSocket(0).use { it.localPort }
            val tokenCalls = java.util.concurrent.atomic.AtomicInteger()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    return when (request.requestUrl!!.encodedPath) {
                        "/oidc/.well-known/openid-configuration" -> MockResponse().setBody(JSONObject().apply {
                            put("authorization_endpoint", server.url("/authorize")); put("token_endpoint", if (mode == "unsent") "http://127.0.0.1:$refusedPort/token" else server.url("/token"))
                            put("end_session_endpoint", server.url("/end")); put("userinfo_endpoint", server.url("/me"))
                            put("jwks_uri", server.url("/jwks")); put("issuer", issuer); put("revocation_endpoint", server.url("/revoke"))
                        }.toString())
                        "/jwks" -> if (mode == "bad-jwks") MockResponse().setResponseCode(503) else MockResponse().setBody("{\"keys\":[${key.toJson()}]}")
                        "/me" -> if (mode == "no-id-info-fail") MockResponse().setResponseCode(503)
                            else MockResponse().setBody("{\"sub\":\"${if (mode == "wrong-info") "other-subject" else "fixture-subject"}\"}")
                        "/token" -> when (if (mode == "nested-invalid" && tokenCalls.incrementAndGet() > 1) "invalid" else mode) {
                            "unknown" -> MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
                            "invalid" -> MockResponse().setResponseCode(400).setBody("{\"error\":\"invalid_grant\"}")
                            else -> MockResponse().setBodyDelay(if (mode == "delayed") 250 else 0, TimeUnit.MILLISECONDS).setBody(JSONObject().apply {
                                put("access_token", "fixture-access"); put("refresh_token", "fixture-new-refresh")
                                if (mode != "no-id-info-fail") put("id_token", if (mode == "invalid-id") "malformed.fixture.token" else token(if (mode == "different-subject") "other-subject" else "fixture-subject"))
                                put("scope", "openid profile custom_data connect"); put("expires_in", 3600)
                            }.toString())
                        }
                        else -> MockResponse().setResponseCode(404)
                    }
                }
            }
            run(server, original)
        }
    }
    @Test fun restartUsesOnlyGrantThenVerifiedRotationIsSavedBeforeAcceptance() = fixture { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "fixed-binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/'))
        sdk.restore(GrantStore(bytes, "fixed-binding").load()!!)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNull(refresh(sdk)); assertTrue(txn.pending)
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "fixed-binding").load() }
        txn.commit()
        assertEquals("fixture-new-refresh", GrantStore(bytes, "fixed-binding").load()!!.refresh)
        assertEquals("fixture-subject", sdk.grant().subject)
        assertEquals(3, server.requestCount) // discovery, token, JWKS; no login UI or hidden second POST.
    }
    @Test fun responseLostOrInvalidGrantNeverReplaysOldGrantAcrossRestart() {
        for (mode in listOf("unknown", "invalid", "bad-jwks", "invalid-id")) fixture(mode) { server, saved ->
            val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
            val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
            val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
            assertNotNull(refresh(sdk)); assertTrue(txn.pending)
            assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "binding").load() }
            if (mode == "invalid") { store.clear(); assertNull(GrantStore(bytes, "binding").load()) }
            val requests = (0 until server.requestCount).map { server.takeRequest(1, TimeUnit.SECONDS)!! }
            assertEquals(1, requests.count { it.path == "/token" })
        }
    }
    @Test fun cryptographicallyValidDifferentSubjectCannotCommitRotation() = fixture("different-subject") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNull(refresh(sdk)) // AAR verifies signature/audience/issuer; our owner additionally binds subject.
        assertThrows(IllegalStateException::class.java) { txn.commit() }
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "binding").load() }
    }
    @Test fun actualUnsentConnectionFailureKeepsRecoverableGrant() = fixture("unsent") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNotNull(refresh(sdk)); assertFalse(txn.pending)
        assertEquals(saved.refresh, GrantStore(bytes, "binding").load()!!.refresh)
        assertEquals(1, server.requestCount) // discovery only; actual token connection was refused.
    }
    @Test fun logoutDuringRealRotationRejectsLateVerifiedCommit() = fixture("delayed") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        val done = CountDownLatch(1)
        sdk.getAccessToken { _, _ -> done.countDown() }
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS)) // discovery
        assertEquals("/token", server.takeRequest(2, TimeUnit.SECONDS)!!.path)
        store.clear()
        assertTrue(done.await(10, TimeUnit.SECONDS))
        assertThrows(IllegalStateException::class.java) { txn.commit() }
        assertNull(GrantStore(bytes, "binding").load())
        sdk.discard()
    }

    private suspend fun profile(sdk: RamClient): ProfileResult = readSdkProfile(sdk, null) {
        suspendCancellableCoroutine { continuation ->
            sdk.getIdTokenClaims { error, value ->
                if (error == null && value != null) continuation.resume(JSONObject(com.google.gson.Gson().toJson(value)))
                else continuation.resumeWithException(IllegalStateException("fixture ID claims error"))
            }
        }
    }
    @Test fun noNewIdAndOnlyUserInfoGetFailureRetainsProtectedIdentityAfterFreshRefresh() = fixture("no-id-info-fail") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNull(refresh(sdk))
        val value = runBlocking { profile(sdk) }
        assertTrue(value.unavailable); assertEquals(saved.subject, value.value.getString("subject"))
        txn.commit()
        assertEquals("fixture-new-refresh", GrantStore(bytes, "binding").load()!!.refresh)
        assertEquals(saved.id, GrantStore(bytes, "binding").load()!!.id)
    }
    @Test fun successfulUserInfoWithWrongSubjectCannotMakePendingReady() = fixture("wrong-info") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNull(refresh(sdk))
        assertThrows(IllegalStateException::class.java) { runBlocking { profile(sdk) } }
        assertTrue(txn.pending)
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "binding").load() }
    }
    @Test fun nestedUserInfoRefreshInvalidGrantIsNeverSwallowedAsGetFallback() = fixture("nested-invalid") { server, saved ->
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); store.save(store.owner(), saved)
        val sdk = client(server.url("/").toString().trimEnd('/')); sdk.restore(saved)
        val txn = RefreshJournal(store, saved.subject, sdk::grant); RefreshObservation.observer = txn
        assertNull(refresh(sdk)); sdk.clearAccessCache()
        assertThrows(IllegalStateException::class.java) { runBlocking { profile(sdk) } }
        assertTrue(txn.pending)
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "binding").load() }
    }

}
