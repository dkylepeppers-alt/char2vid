package com.char2vid.studio.jobs

import org.json.JSONArray
import org.json.JSONObject

data class ImageOutputItem(
    val ordinal: Int,
    val url: String?,
    val base64: String?,
)

object ImageOutputParser {
    fun parse(body: JSONObject): List<ImageOutputItem> {
        val rawItems = itemsFromBody(body)
        if (rawItems != null) {
            require(rawItems.length() > 0) { "missing_image_output" }
            return (0 until rawItems.length()).map { index ->
                itemFromUnknown(rawItems.get(index), index)
                    ?: throw IllegalArgumentException("missing_image_output")
            }
        }
        val single = itemFromUnknown(body, 0) ?: throw IllegalArgumentException("missing_image_output")
        return listOf(single)
    }

    fun ticketRunId(body: JSONObject): String? {
        val runId = body.optString("runId").ifBlank { body.optString("id") }
        return runId.takeIf { it.isNotBlank() }
    }

    private fun itemsFromBody(body: JSONObject): JSONArray? {
        body.optJSONArray("data")?.let { return it }
        body.optJSONObject("output")?.optJSONArray("images")?.let { return it }
        return body.optJSONArray("images")
    }

    private fun itemFromUnknown(value: Any?, ordinal: Int): ImageOutputItem? {
        if (value is String && value.isNotEmpty()) {
            return if (value.startsWith("http://") || value.startsWith("https://")) {
                ImageOutputItem(ordinal, value, null)
            } else {
                ImageOutputItem(ordinal, null, value)
            }
        }
        val record = value as? JSONObject ?: return null
        val nested = record.optJSONObject("image")
        val url =
            record.optString("url").ifBlank { nested?.optString("url").orEmpty() }
                .ifBlank { record.optString("imageUrl") }
                .ifBlank { null }
        val base64 =
            record.optString("b64_json").ifBlank { record.optString("b64Json") }
                .ifBlank { record.optString("base64") }
                .ifBlank { null }
        if (url != null) {
            return ImageOutputItem(ordinal, url, null)
        }
        if (base64 != null) {
            return ImageOutputItem(ordinal, null, base64)
        }
        return null
    }
}

object VideoStatusParser {
    data class Status(
        val state: String,
        val outputUrl: String?,
        val error: String?,
    )

    fun parse(body: JSONObject): Status {
        val nested = body.optJSONObject("data")
        val statusRaw = nested?.optString("status")?.ifBlank { null }
            ?: body.optString("status").ifBlank { null }
            ?: throw IllegalArgumentException("unsupported_video_envelope")
        val state = mapStatus(statusRaw) ?: throw IllegalArgumentException("unsupported_video_envelope")
        val outputUrl =
            if (nested != null) {
                nested.optJSONObject("output")?.optJSONObject("video")?.optString("url")
                    ?.ifBlank { null }
                    ?: nested.optJSONObject("output")?.optString("url")?.ifBlank { null }
            } else {
                body.optString("videoUrl").ifBlank { body.optString("outputUrl") }.ifBlank { null }
            }
        val error =
            nested?.optString("error")?.ifBlank { null }
                ?: body.optString("error").ifBlank { null }
                ?: nested?.optString("message")?.ifBlank { null }
                ?: body.optString("message").ifBlank { null }
        if (state == "completed" && outputUrl == null) {
            throw IllegalArgumentException("missing_video_output")
        }
        return Status(state, outputUrl, error)
    }

    private fun mapStatus(raw: String): String? {
        val status = raw.trim().lowercase().replace('_', '-')
        return when (status) {
            "completed", "success", "succeeded" -> "completed"
            "failed", "error" -> "failed"
            "cancelled", "canceled" -> "cancelled"
            "pending",
            "queued",
            "running",
            "processing",
            "in-progress",
            "submitted",
            "not-start",
            "in-queue",
            "unknown",
            -> "running"
            else -> null
        }
    }
}
