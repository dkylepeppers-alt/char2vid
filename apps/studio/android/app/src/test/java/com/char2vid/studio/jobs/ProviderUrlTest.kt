package com.char2vid.studio.jobs

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderUrlTest {
    @Test
    fun acceptsHttpsNanoGptSubmitUrls() {
        assertTrue(ProviderUrls.isNanoGptSubmitUrl("https://nano-gpt.com/api/v1/images"))
        assertTrue(ProviderUrls.isNanoGptSubmitUrl("https://nano-gpt.com/api/generate-video"))
        assertTrue(ProviderUrls.isNanoGptSubmitUrl("https://www.nano-gpt.com/v1/images/generations"))
    }

    @Test
    fun rejectsNonProviderSubmitUrls() {
        assertFalse(ProviderUrls.isNanoGptSubmitUrl("http://nano-gpt.com/api/v1/images"))
        assertFalse(ProviderUrls.isNanoGptSubmitUrl("https://evil.example/steal"))
        assertFalse(ProviderUrls.isNanoGptSubmitUrl("https://nano-gpt.com.evil.example/api"))
        assertFalse(ProviderUrls.isNanoGptSubmitUrl("https://user:pass@nano-gpt.com/api"))
        assertFalse(ProviderUrls.isNanoGptSubmitUrl("file:///data/local/tmp"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsLocalhostDownloads() {
        ProviderUrls.requirePublicHttpsDownload("https://localhost/output.mp4")
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsCleartextDownloads() {
        ProviderUrls.requirePublicHttpsDownload("http://cdn.example/output.mp4")
    }
}
