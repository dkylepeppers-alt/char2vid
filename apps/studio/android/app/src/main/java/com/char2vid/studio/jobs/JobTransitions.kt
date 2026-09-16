package com.char2vid.studio.jobs

data class DeviceJob(
    val id: String,
    val clientRequestId: String,
    val operation: String,
    val requestUrl: String,
    val requestMethod: String,
    val requestBodyJson: String,
    val providerState: String,
    val saveState: String,
    val providerRunId: String?,
    val errorCode: String?,
    val pollCount: Int,
    val nextPollAtMs: Long?,
    val outputJson: String?,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

object JobTransitions {
    fun markSubmitting(job: DeviceJob, nowMs: Long): DeviceJob =
        job.copy(providerState = "submitting", updatedAtMs = nowMs, errorCode = null)

    fun recoverStaleSubmit(job: DeviceJob, nowMs: Long): DeviceJob {
        if (job.providerState != "submitting") {
            return job
        }
        return job.copy(
            providerState = "submission-unknown",
            errorCode = "submission_unknown",
            updatedAtMs = nowMs,
        )
    }

    fun markRunning(job: DeviceJob, runId: String, nowMs: Long): DeviceJob =
        job.copy(
            providerState = "running",
            providerRunId = runId,
            saveState = "absent",
            errorCode = null,
            updatedAtMs = nowMs,
        )

    fun schedulePoll(job: DeviceJob, nowMs: Long): DeviceJob {
        val nextCount = job.pollCount + 1
        val shift = (nextCount - 1).coerceIn(0, 10)
        val delay = minOf(30_000L, 1_000L shl shift)
        return job.copy(
            pollCount = nextCount,
            nextPollAtMs = nowMs + delay,
            updatedAtMs = nowMs,
        )
    }

    fun markCompleted(job: DeviceJob, outputJson: String, nowMs: Long): DeviceJob =
        job.copy(
            providerState = "completed",
            saveState = "saved",
            outputJson = outputJson,
            nextPollAtMs = null,
            errorCode = null,
            updatedAtMs = nowMs,
        )

    fun markFailed(job: DeviceJob, code: String, nowMs: Long): DeviceJob =
        job.copy(
            providerState = "failed",
            errorCode = code,
            nextPollAtMs = null,
            updatedAtMs = nowMs,
        )

    fun cancelQueued(job: DeviceJob, nowMs: Long): DeviceJob? {
        if (job.providerState != "queued") {
            return null
        }
        return job.copy(providerState = "cancelled", updatedAtMs = nowMs)
    }
}
