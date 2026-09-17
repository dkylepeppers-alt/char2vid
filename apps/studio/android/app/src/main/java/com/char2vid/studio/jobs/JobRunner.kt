package com.char2vid.studio.jobs

import android.content.Context
import com.char2vid.studio.library.MediaStoreRepository
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.UUID

class JobRunner(
    private val dao: DeviceJobDao,
    private val http: ProviderHttp,
    private val keys: ProviderKeyStore,
    private val library: MediaStoreRepository,
    private val cacheDir: File,
    private val nowMs: () -> Long,
) {
    fun recoverStaleSubmits() {
        val now = nowMs()
        for (row in dao.listSubmitting()) {
            dao.update(JobTransitions.recoverStaleSubmit(row.toModel(), now).toEntity())
        }
    }

    fun hasWork(now: Long = nowMs()): Boolean {
        return dao.nextQueued() != null || dao.nextDuePoll(now) != null
    }

    fun tick(): Boolean {
        recoverStaleSubmits()
        val now = nowMs()
        val queued = dao.nextQueued()?.toModel()
        if (queued != null) {
            submit(queued)
            return true
        }
        val due = dao.nextDuePoll(now)?.toModel()
        if (due != null) {
            poll(due)
            return true
        }
        return false
    }

    private fun submit(job: DeviceJob) {
        val now = nowMs()
        val submitting = JobTransitions.markSubmitting(job, now)
        dao.update(submitting.toEntity())
        val apiKey = keys.load()
        if (apiKey.isNullOrBlank()) {
            dao.update(JobTransitions.markFailed(submitting, "provider_key_missing", nowMs()).toEntity())
            return
        }
        if (!ProviderUrls.isNanoGptSubmitUrl(submitting.requestUrl)) {
            dao.update(JobTransitions.markFailed(submitting, "provider_url_rejected", nowMs()).toEntity())
            return
        }
        val result =
            try {
                http.postJson(submitting.requestUrl, submitting.requestBodyJson, apiKey)
            } catch (_: Exception) {
                dao.update(JobTransitions.recoverStaleSubmit(submitting, nowMs()).toEntity())
                return
            }
        if (result.status == 429) {
            dao.update(JobTransitions.markFailed(submitting, "provider_rate_limited", nowMs()).toEntity())
            return
        }
        if (result.status >= 400) {
            dao.update(
                JobTransitions.markFailed(submitting, "provider_${result.status}", nowMs()).toEntity(),
            )
            return
        }
        try {
            if (submitting.operation.startsWith("video")) {
                handleVideoSubmit(submitting, result.body)
            } else {
                handleImageLike(submitting, result)
            }
        } catch (error: Exception) {
            dao.update(
                JobTransitions.markFailed(
                    submitting,
                    error.message ?: "capture_failed",
                    nowMs(),
                ).toEntity(),
            )
        }
    }

    private fun handleVideoSubmit(job: DeviceJob, bodyText: String) {
        val body = JSONObject(bodyText.ifBlank { "{}" })
        val runId = ImageOutputParser.ticketRunId(body)
        if (runId.isNullOrBlank()) {
            dao.update(JobTransitions.markFailed(job, "missing_provider_run_id", nowMs()).toEntity())
            return
        }
        val running = JobTransitions.schedulePoll(JobTransitions.markRunning(job, runId, nowMs()), nowMs())
        dao.update(running.toEntity())
    }

    private fun handleImageLike(job: DeviceJob, result: ProviderHttpResult) {
        if (job.operation == "speech" || job.operation == "music") {
            if (result.contentType.startsWith("audio/") || result.contentType == "application/octet-stream") {
                val mime = OutputMime.infer(job.operation, result.contentType, result.bytes)
                saveBytes(job, 0, result.bytes, mime)
                return
            }
        }
        val body = JSONObject(result.body.ifBlank { "{}" })
        val items =
            try {
                ImageOutputParser.parse(body)
            } catch (_: Exception) {
                val runId = ImageOutputParser.ticketRunId(body)
                if (!runId.isNullOrBlank()) {
                    dao.update(
                        JobTransitions.schedulePoll(
                            JobTransitions.markRunning(job, runId, nowMs()),
                            nowMs(),
                        ).toEntity(),
                    )
                    return
                }
                throw IllegalArgumentException("missing_image_output")
            }
        val outputs = JSONArray()
        for (item in items) {
            val bytes =
                if (item.url != null) {
                    http.downloadOutput(item.url).bytes
                } else {
                    Base64.getDecoder().decode(item.base64)
                }
            val claimed =
                if (job.operation.startsWith("video")) {
                    "video/mp4"
                } else {
                    "image/png"
                }
            val mime = OutputMime.infer(job.operation, claimed, bytes)
            outputs.put(importOutput(job, item.ordinal, bytes, mime))
        }
        dao.update(JobTransitions.markCompleted(job, outputs.toString(), nowMs()).toEntity())
    }

    private fun poll(job: DeviceJob) {
        if (job.pollCount >= MAX_POLLS) {
            dao.update(JobTransitions.markFailed(job, "poll_exhausted", nowMs()).toEntity())
            return
        }
        val apiKey = keys.load()
        val runId = job.providerRunId
        if (apiKey.isNullOrBlank() || runId.isNullOrBlank()) {
            dao.update(JobTransitions.markFailed(job, "recovery_required", nowMs()).toEntity())
            return
        }
        val url = "https://nano-gpt.com/api/video/status?requestId=${java.net.URLEncoder.encode(runId, "UTF-8")}"
        val result =
            try {
                http.getJson(url, apiKey)
            } catch (_: Exception) {
                dao.update(JobTransitions.schedulePoll(job, nowMs()).toEntity())
                return
            }
        if (result.status >= 400) {
            dao.update(JobTransitions.schedulePoll(job, nowMs()).toEntity())
            return
        }
        try {
            val status = VideoStatusParser.parse(JSONObject(result.body.ifBlank { "{}" }))
            when (status.state) {
                "running", "queued" ->
                    dao.update(JobTransitions.schedulePoll(job, nowMs()).toEntity())
                "failed", "cancelled" ->
                    dao.update(
                        JobTransitions.markFailed(job, status.error ?: status.state, nowMs()).toEntity(),
                    )
                "completed" -> {
                    val downloaded = http.downloadOutput(status.outputUrl!!)
                    val mime = OutputMime.infer(job.operation, downloaded.contentType, downloaded.bytes)
                    val outputs = JSONArray()
                    outputs.put(importOutput(job, 0, downloaded.bytes, mime))
                    dao.update(JobTransitions.markCompleted(job, outputs.toString(), nowMs()).toEntity())
                }
            }
        } catch (error: Exception) {
            dao.update(
                JobTransitions.markFailed(job, error.message ?: "capture_failed", nowMs()).toEntity(),
            )
        }
    }

    private fun saveBytes(job: DeviceJob, ordinal: Int, bytes: ByteArray, mime: String) {
        val outputs = JSONArray()
        outputs.put(importOutput(job, ordinal, bytes, mime))
        dao.update(JobTransitions.markCompleted(job, outputs.toString(), nowMs()).toEntity())
    }

    private fun importOutput(
        job: DeviceJob,
        ordinal: Int,
        bytes: ByteArray,
        mime: String,
    ): JSONObject {
        val ext = OutputMime.extensionFor(mime)
        val file = File(cacheDir, "job-${job.id}-$ordinal.$ext")
        try {
            file.writeBytes(bytes)
            val imported =
                library.importFromNativeUri(
                    file.toURI().toString(),
                    file.name,
                    mime,
                )
            return JSONObject()
                .put("ordinal", ordinal)
                .put("sha256", imported.sha256)
                .put("mime", mime)
                .put("bytes", bytes.size)
                .put("revisionId", imported.revisionId)
        } finally {
            file.delete()
        }
    }

    companion object {
        private const val MAX_POLLS = 40

        fun enqueue(
            context: Context,
            clientRequestId: String,
            operation: String,
            requestUrl: String,
            requestMethod: String,
            requestBodyJson: String,
            characterSlotJson: String? = null,
        ): DeviceJob {
            ProviderUrls.requireNanoGptSubmitUrl(requestUrl)
            val db = JobDatabase.getInstance(context)
            val existing = db.jobs().getByClientRequestId(clientRequestId)?.toModel()
            if (existing != null) {
                return existing
            }
            val now = System.currentTimeMillis()
            val job =
                DeviceJob(
                    id = UUID.randomUUID().toString().replace("-", ""),
                    clientRequestId = clientRequestId,
                    operation = operation,
                    requestUrl = requestUrl,
                    requestMethod = requestMethod,
                    requestBodyJson = requestBodyJson,
                    providerState = "queued",
                    saveState = "absent",
                    providerRunId = null,
                    errorCode = null,
                    pollCount = 0,
                    nextPollAtMs = null,
                    outputJson = null,
                    characterSlotJson = characterSlotJson,
                    createdAtMs = now,
                    updatedAtMs = now,
                )
            db.jobs().insert(job.toEntity())
            JobForegroundService.start(context)
            JobRestartWorker.enqueue(context)
            return job
        }
    }
}
