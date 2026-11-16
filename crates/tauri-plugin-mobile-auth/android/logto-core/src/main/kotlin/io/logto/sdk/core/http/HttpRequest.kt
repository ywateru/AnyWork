package io.logto.sdk.core.http

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import io.logto.sdk.core.exception.ResponseException
import okhttp3.FormBody
import okhttp3.EventListener
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import java.io.IOException
import java.util.concurrent.TimeUnit

val gson: Gson by lazy {
    GsonBuilder().setFieldNamingStrategy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES).create()
}

// Local transport policy: an unknown rotating-grant outcome must never replay.
val httpClient by lazy {
    OkHttpClient.Builder()
        .retryOnConnectionFailure(false)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()
}

// OkHttp follow-ups (including 503/421) also consult this one-shot contract.
// Delegate bytes and metadata unchanged; OAuth form construction stays upstream.
private class OneShotBody(private val delegate: RequestBody) : RequestBody() {
    override fun contentType() = delegate.contentType()
    override fun contentLength() = delegate.contentLength()
    override fun isDuplex() = delegate.isDuplex()
    override fun isOneShot() = true
    override fun writeTo(sink: BufferedSink) = delegate.writeTo(sink)
}

/** One serialized native owner installs this only while executing its SDK call.
 * No token or response data is delivered. Pending is durable before enqueue;
 * requestHeadersStart precedes OkHttp writing headers on HTTP/1 and HTTP/2. */
interface RefreshRequestObserver {
    // A monotonic budget shared by all GET/POST calls of the SDK operation.
    fun remainingMillis(): Long = 60000
    fun beforeRequest()
    fun failedBeforeHeaders()
}
object RefreshObservation {
    @Volatile var observer: RefreshRequestObserver? = null
}

fun makeRequest(
    uri: String,
    body: RequestBody?,
    headers: Map<String, String>?,
    completion: HttpRawStringCompletion,
) = makeRequest(
    uri,
    body,
    headers,
    object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            completion.onComplete(e, null)
        }

        override fun onResponse(call: Call, response: Response) {
            val content = try { response.use { it.body?.string() } }
            catch (error: IOException) { completion.onComplete(error, null); return }
            if (!response.isSuccessful) {
                completion.onComplete(
                    ResponseException(ResponseException.Type.REQUEST_FAILED).apply {
                        responseCode = response.code
                        responseMessage = response.message
                        responseContent = content
                    },
                    null,
                )
                return
            }

            content?.let {
                completion.onComplete(null, it)
            } ?: completion.onComplete(ResponseException(ResponseException.Type.EMPTY_RESPONSE), null)
        }
    },
)

fun makeRequest(
    uri: String,
    body: RequestBody?,
    headers: Map<String, String>?,
    completion: HttpEmptyCompletion,
) = makeRequest(
    uri,
    body,
    headers,
    object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            completion.onComplete(e)
        }

        override fun onResponse(call: Call, response: Response) {
            val content = try { response.use { if (it.isSuccessful) null else it.body?.string() } }
            catch (error: IOException) { completion.onComplete(error); return }
            response.takeIf { it.isSuccessful }?.let {
                completion.onComplete(null)
            } ?: completion.onComplete(
                ResponseException(ResponseException.Type.REQUEST_FAILED).apply {
                    responseCode = response.code
                    responseMessage = response.message
                    responseContent = content
                },
            )
        }
    },
)

fun makeRequest(
    uri: String,
    body: RequestBody?,
    headers: Map<String, String>?,
    responseCallback: Callback,
) {
    val request = Request.Builder().url(uri).apply {
        body?.let { post(OneShotBody(it)) }
        headers?.let {
            for ((key, value) in it) {
                addHeader(key, value)
            }
        }
    }.build()
    val rotating = body is FormBody && (0 until body.size).any {
        body.name(it) == "grant_type" && body.value(it) == "refresh_token"
    }
    val operation = RefreshObservation.observer
    val remaining = operation?.remainingMillis() ?: 60000
    if (remaining <= 0) {
        responseCallback.onFailure(httpClient.newCall(request), IOException("AUTH_OPERATION_TIMEOUT"))
        return
    }
    val bounded = httpClient.newBuilder().callTimeout(minOf(60000, remaining), TimeUnit.MILLISECONDS).build()
    val observer = if (rotating) operation else null
    if (observer == null) { bounded.newCall(request).enqueue(responseCallback); return }
    try { observer.beforeRequest() } catch (error: Exception) {
        responseCallback.onFailure(httpClient.newCall(request), IOException("REFRESH_STORAGE_UNAVAILABLE", error))
        return
    }
    val headersStarted = AtomicBoolean(false)
    val observed = bounded.newBuilder().eventListener(object : EventListener() {
        override fun requestHeadersStart(call: Call) { headersStarted.set(true) }
    }).build()
    observed.newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!headersStarted.get()) {
                try { observer.failedBeforeHeaders() } catch (_: Exception) {
                    responseCallback.onFailure(call, IOException("REFRESH_STORAGE_UNAVAILABLE")); return
                }
            }
            responseCallback.onFailure(call, e)
        }
        override fun onResponse(call: Call, response: Response) = responseCallback.onResponse(call, response)
    })
}
