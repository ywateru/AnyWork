package io.logto.sdk.core.http

import com.google.gson.FieldNamingPolicy
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import io.logto.sdk.core.exception.ResponseException
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
            if (!response.isSuccessful) {
                completion.onComplete(
                    ResponseException(ResponseException.Type.REQUEST_FAILED).apply {
                        responseCode = response.code
                        responseMessage = response.message
                        responseContent = response.body?.string()
                    },
                    null,
                )
                return
            }

            response.let { it.body?.string() }?.let {
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
            response.takeIf { it.isSuccessful }?.let {
                completion.onComplete(null)
            } ?: completion.onComplete(
                ResponseException(ResponseException.Type.REQUEST_FAILED).apply {
                    responseCode = response.code
                    responseMessage = response.message
                    responseContent = response.body?.string()
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
    httpClient.newCall(request).enqueue(responseCallback)
}
