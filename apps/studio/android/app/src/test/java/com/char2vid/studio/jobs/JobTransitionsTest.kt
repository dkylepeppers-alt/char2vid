package com.char2vid.studio.jobs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JobTransitionsTest {
    private fun queued() =
        DeviceJob(
            id = "job-1",
            clientRequestId = "req-1",
            operation = "image-generate",
            requestUrl = "https://nano-gpt.com/api/v1/images",
            requestMethod = "POST",
            requestBodyJson = """{"model":"fixture"}""",
            providerState = "queued",
            saveState = "absent",
            providerRunId = null,
            errorCode = null,
            pollCount = 0,
            nextPollAtMs = null,
            outputJson = null,
            createdAtMs = 1_000,
            updatedAtMs = 1_000,
        )

    @Test
    fun queuedJobCanBeCancelled() {
        val cancelled = JobTransitions.cancelQueued(queued(), 2_000)
        assertEquals("cancelled", cancelled?.providerState)
        assertEquals(2_000L, cancelled?.updatedAtMs)
    }

    @Test
    fun submittingJobCannotBeCancelled() {
        val submitting = JobTransitions.markSubmitting(queued(), 2_000)
        assertNull(JobTransitions.cancelQueued(submitting, 3_000))
    }

    @Test
    fun crashWhileSubmittingBecomesUnknownNotQueued() {
        val submitting = JobTransitions.markSubmitting(queued(), 2_000)
        val recovered = JobTransitions.recoverStaleSubmit(submitting, 3_000)
        assertEquals("submission-unknown", recovered.providerState)
        assertEquals("submission_unknown", recovered.errorCode)
    }

    @Test
    fun videoTicketSchedulesExponentialPoll() {
        val running =
            JobTransitions.markRunning(
                JobTransitions.markSubmitting(queued(), 2_000),
                "run-9",
                3_000,
            )
        val waiting = JobTransitions.schedulePoll(running, 3_000)
        assertEquals("running", waiting.providerState)
        assertEquals("run-9", waiting.providerRunId)
        assertEquals(1, waiting.pollCount)
        assertEquals(3_000 + 1_000L, waiting.nextPollAtMs)
    }
}
