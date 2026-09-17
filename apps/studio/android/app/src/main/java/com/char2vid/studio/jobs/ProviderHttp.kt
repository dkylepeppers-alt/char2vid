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
    val location: String? = null,
)

class ProviderHttp {
    fun postJson(url: String, body: String, apiKey: String): ProviderHttpResult {
        ProviderUrls.requireNanoGptSubmitUrl(url)
        return request("POST", url, body, apiKey, MAX_JSON_BYTES, followRedirects = false)
    }

    fun getJson(url: String, apiKey: String): ProviderHttpResult {
        ProviderUrls.requireNanoGptSubmitUrl(url)
        return request("GET", url, null, apiKey, MAX_JSON_BYTES, followRedirects = false)
    }

    fun downloadOutput(url: String): ProviderHttpResult {
        return downloadFollow(url, 0)
    }

    private fun downloadFollow(url: String, depth: Int): ProviderHttpResult {
        if (depth > MAX_REDIRECTS) {
            throw IllegalArgumentException("output_redirect_limit")
        }
        ProviderUrls.requirePublicHttpsDownload(url)
        val result = request("GET", url, null, null, MAX_OUTPUT_BYTES, followRedirects = false)
        if (result.status in 300..399) {
            val location = result.location ?: throw IllegalArgumentException("output_redirect_missing")
            val next =
                if (URI(location).isAbsolute) {
                    location
                } else {
                    URI(url).resolve(location).toString()
                }
            return downloadFollow(next, depth + 1)
        }
        if (result.status !in 200..299) {
            throw IllegalArgumentException("output_${result.status}")
        }
        if (result.bytes.isEmpty()) {
            throw IllegalArgumentException("empty_output")
        }
        return result
    }

    private fun request(
        method: String,
        url: String,
        body: String?,
        apiKey: String?,
        maxBytes: Int,
        followRedirects: Boolean,
    ): ProviderHttpResult {
        val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 120_000
        connection.requestMethod = method
        connection.instanceFollowRedirects = followRedirects
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
            if (stream == null) {
                ByteArray(0)
            } else {
                stream.use { input ->
                    val buffer = ByteArrayOutputStream()
                    val chunk = ByteArray(16 * 1024)
                    var total = 0
                    while (true) {
                        val read = input.read(chunk)
                        if (read < 0) {
                            break
                        }
                        total += read
                        if (total > maxBytes) {
                            throw IllegalArgumentException("output_too_large")
                        }
                        buffer.write(chunk, 0, read)
                    }
                    buffer.toByteArray()
                }
            }
        val contentType = connection.contentType ?: "application/octet-stream"
        return ProviderHttpResult(
            status = connection.responseCode,
            body = String(bytes, StandardCharsets.UTF_8),
            bytes = bytes,
            contentType = contentType,
            location = connection.getHeaderField("Location"),
        )
    }

    companion object {
        const val MAX_OUTPUT_BYTES = 50 * 1024 * 1024
        const val MAX_JSON_BYTES = 8 * 1024 * 1024
        const val MAX_REDIRECTS = 3
    }
}
