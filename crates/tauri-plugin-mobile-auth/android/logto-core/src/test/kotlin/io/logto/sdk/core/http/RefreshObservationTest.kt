package io.logto.sdk.core.http

import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class RefreshObservationTest {
    @After fun reset() { RefreshObservation.observer = null }
    private fun request(url: String, observer: RefreshRequestObserver) {
        RefreshObservation.observer = observer
        val done = CountDownLatch(1)
        makeRequest(url, FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", "fixture").build(), null,
            object : Callback {
                override fun onFailure(call: Call, e: IOException) { done.countDown() }
                override fun onResponse(call: Call, response: Response) { response.close(); done.countDown() }
            })
        assertTrue(done.await(10, TimeUnit.SECONDS))
    }
    @Test fun actualConnectFailureBeforeAnyRequestHeadersIsRecoverable() {
        val port = ServerSocket(0).use { it.localPort }
        val begun = AtomicInteger(); val unsent = AtomicInteger()
        request("http://127.0.0.1:$port/token", object : RefreshRequestObserver {
            override fun beforeRequest() { begun.incrementAndGet() }
            override fun failedBeforeHeaders() { unsent.incrementAndGet() }
        })
        assertEquals(1, begun.get()); assertEquals(1, unsent.get())
    }
    @Test fun actualResponseLossAfterRequestNeverReportsUnsent() {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
            val begun = AtomicInteger(); val unsent = AtomicInteger()
            request(server.url("/token").toString(), object : RefreshRequestObserver {
                override fun beforeRequest() { begun.incrementAndGet() }
                override fun failedBeforeHeaders() { unsent.incrementAndGet() }
            })
            assertEquals(1, begun.get()); assertEquals(0, unsent.get()); assertEquals(1, server.requestCount)
        }
    }
    @Test fun durablePendingFailurePreventsDispatchCompletely() {
        MockWebServer().use { server ->
            server.start()
            request(server.url("/token").toString(), object : RefreshRequestObserver {
                override fun beforeRequest() { throw IOException("fixture store unavailable") }
                override fun failedBeforeHeaders() { fail("not enqueued") }
            })
            assertEquals(0, server.requestCount)
        }
    }
    @Test fun expiredOperationBudgetDoesNotDispatchOrMarkRefreshPending() {
        MockWebServer().use { server ->
            server.start()
            request(server.url("/token").toString(), object : RefreshRequestObserver {
                override fun remainingMillis() = 0L
                override fun beforeRequest() { fail("expired before durable pending") }
                override fun failedBeforeHeaders() { fail("not enqueued") }
            })
            assertEquals(0, server.requestCount)
        }
    }
    @Test fun operationBudgetBoundsGetBodyAndPostWithoutReplaying() {
        for (body in listOf(null, FormBody.Builder().add("grant_type", "refresh_token").build())) {
            MockWebServer().use { server ->
                server.start()
                val unsent = AtomicInteger()
                RefreshObservation.observer = object : RefreshRequestObserver {
                    override fun remainingMillis() = 1000L
                    override fun beforeRequest() {}
                    override fun failedBeforeHeaders() { unsent.incrementAndGet() }
                }
                server.enqueue(MockResponse().setBody("fixture").setBodyDelay(4, TimeUnit.SECONDS))
                val done = CountDownLatch(1)
                val errors = AtomicInteger()
                makeRequest(server.url("/budget").toString(), body, null, HttpRawStringCompletion { error, _ ->
                    if (error != null) errors.incrementAndGet()
                    done.countDown()
                })
                assertTrue("total call budget also bounds response body", done.await(3, TimeUnit.SECONDS))
                assertEquals(1, errors.get())
                assertEquals(0, unsent.get())
                assertEquals(1, server.requestCount)
            }
        }
    }
    @Test fun truncatedResponseBodyCompletesOnceRatherThanStrandingRestore() {
        MockWebServer().use { server ->
            server.start(); server.enqueue(MockResponse().setBody("fixture".repeat(1000))
                .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY))
            val done = CountDownLatch(1); val calls = AtomicInteger()
            makeRequest(server.url("/token").toString(),
                FormBody.Builder().add("grant_type", "refresh_token").build(), null,
                HttpRawStringCompletion { error, body ->
                    assertNotNull(error); assertNull(body); calls.incrementAndGet(); done.countDown()
                })
            assertTrue(done.await(10, TimeUnit.SECONDS)); assertEquals(1, calls.get())
            assertEquals(1, server.requestCount)
        }
    }

}
