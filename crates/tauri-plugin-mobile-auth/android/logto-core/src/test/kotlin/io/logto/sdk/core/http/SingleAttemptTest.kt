package io.logto.sdk.core.http

import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class SingleAttemptTest {

    private fun singleAttempt(response: MockResponse, expectedCode: Int? = null) {
        MockWebServer().use { origin ->
            MockWebServer().use { destination ->
                origin.start()
                destination.start()
                origin.enqueue(response.setHeader("Location", destination.url("/redirect")))
                // Any erroneous replay must terminate, rather than hang this test.
                origin.enqueue(MockResponse().setResponseCode(200).setBody("replayed"))
                destination.enqueue(MockResponse().setResponseCode(200).setBody("redirected"))
                val done = CountDownLatch(1)
                val failure = AtomicReference<Throwable?>()
                makeRequest(
                    origin.url("/token").toString(),
                    FormBody.Builder().add("grant_type", "refresh_token")
                        .add("refresh_token", "fixture-rotation-grant").build(),
                    null,
                    object : Callback {
                        override fun onFailure(call: Call, e: IOException) {
                            if (expectedCode != null) failure.set(e)
                            done.countDown()
                        }
                        override fun onResponse(call: Call, response: Response) {
                            response.use {
                                try {
                                    assertEquals(expectedCode, it.code)
                                    assertTrue(call.request().body!!.isOneShot())
                                } catch (e: Throwable) { failure.set(e) }
                            }
                            done.countDown()
                        }
                    },
                )
                assertTrue("callback did not terminate", done.await(10, TimeUnit.SECONDS))
                failure.get()?.let { throw AssertionError("callback failure", it) }
                val received = origin.takeRequest(1, TimeUnit.SECONDS)!!
                assertEquals("POST", received.method)
                assertEquals("grant_type=refresh_token&" + "refresh_token=" + "fixture-rotation-grant", received.body.readUtf8())
                // Callback completion occurs after OkHttp follow-up decisions.
                assertEquals(1, origin.requestCount)
                assertEquals(0, destination.requestCount)
            }
        }
    }

    @Test fun eofAfterCompleteRequestBodyNeverReplays() = singleAttempt(
        MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST),
    )
    @Test fun requestTimeout408NeverReplays() = singleAttempt(MockResponse().setResponseCode(408), 408)
    @Test fun retryAfterZero503NeverReplays() = singleAttempt(
        MockResponse().setResponseCode(503).setHeader("Retry-After", "0"), 503,
    )
    // HTTP/1 fixture exercises the real request/body path. The coalesced HTTP/2
    // branch is covered by pinned OkHttp source analysis, not claimed as runtime.
    @Test fun misdirected421RetainsOneShotBody() = singleAttempt(MockResponse().setResponseCode(421), 421)
    @Test fun redirect307NeverReachesDestination() = singleAttempt(MockResponse().setResponseCode(307), 307)
    @Test fun redirect308NeverReachesDestination() = singleAttempt(MockResponse().setResponseCode(308), 308)

    @Test fun transportPolicyIsExplicitAndBounded() {
        assertFalse(httpClient.retryOnConnectionFailure)
        assertFalse(httpClient.followRedirects)
        assertFalse(httpClient.followSslRedirects)
        assertEquals(15_000, httpClient.connectTimeoutMillis)
        assertEquals(30_000, httpClient.readTimeoutMillis)
        assertEquals(30_000, httpClient.writeTimeoutMillis)
        assertEquals(60_000, httpClient.callTimeoutMillis)
    }
}
