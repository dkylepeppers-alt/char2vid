package com.char2vid.studio.jobs

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets

data class ProviderHttpResult(
    val status: Int,
    val body: String,
    val bytes: ByteArray,
    val contentType: String,
)

class ProviderHttp {
    fun postJson(url: String, body: String, apiKey: String): ProviderHttpResult =
        request("POST", url, body, apiKey)

    fun getJson(url: String, apiKey: String): ProviderHttpResult =
        request("GET", url, null, apiKey)

    fun getBytes(url: String): ByteArray = request("GET", url, null, null).bytes

    private fun request(
        method: String,
        url: String,
        body: String?,
        apiKey: String?,
    ): ProviderHttpResult {
        val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 120_000
        connection.requestMethod = method
        connection.instanceFollowRedirects = true
        if (apiKey != null) {
            connection.setRequestProperty("Authorization", "Bearer $apiKey")
        }
        if (body != null) {
            val payload = body.toByteArray(StandardCharsets.UTF_8)
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
        }
        val stream =
            if (connection.responseCode >= 400) {
                connection.errorStream ?: connection.inputStream
            } else {
                connection.inputStream
            }
        val bytes =
            stream.use { input ->
                val buffer = ByteArrayOutputStream()
                input.copyTo(buffer)
                buffer.toByteArray()
            }
        val contentType = connection.contentType ?: "application/octet-stream"
        return ProviderHttpResult(
            status = connection.responseCode,
            body = String(bytes, StandardCharsets.UTF_8),
            bytes = bytes,
            contentType = contentType,
        )
    }
}
