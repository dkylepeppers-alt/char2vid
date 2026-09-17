package com.char2vid.studio.jobs

import java.net.InetAddress
import java.net.URI

object ProviderUrls {
    fun isNanoGptSubmitUrl(url: String): Boolean {
        val uri = parseHttps(url) ?: return false
        if (!uri.userInfo.isNullOrBlank()) {
            return false
        }
        val host = uri.host?.lowercase() ?: return false
        return host == "nano-gpt.com" || host == "www.nano-gpt.com"
    }

    fun requireNanoGptSubmitUrl(url: String): URI {
        if (!isNanoGptSubmitUrl(url)) {
            throw IllegalArgumentException("provider_url_rejected")
        }
        return URI(url)
    }

    fun requirePublicHttpsDownload(url: String): URI {
        val uri = parseHttps(url) ?: throw IllegalArgumentException("insecure_output_url")
        if (!uri.userInfo.isNullOrBlank()) {
            throw IllegalArgumentException("insecure_output_url")
        }
        val host = uri.host?.lowercase() ?: throw IllegalArgumentException("insecure_output_url")
        if (
            host == "localhost" ||
            host.endsWith(".localhost") ||
            host == "metadata.google.internal"
        ) {
            throw IllegalArgumentException("private_output_url")
        }
        val address = InetAddress.getByName(host)
        if (
            address.isLoopbackAddress ||
            address.isAnyLocalAddress ||
            address.isLinkLocalAddress ||
            address.isSiteLocalAddress ||
            address.isMulticastAddress
        ) {
            throw IllegalArgumentException("private_output_url")
        }
        return uri
    }

    private fun parseHttps(url: String): URI? {
        val uri =
            try {
                URI(url)
            } catch (_: Exception) {
                return null
            }
        if (uri.scheme?.lowercase() != "https") {
            return null
        }
        if (uri.host.isNullOrBlank()) {
            return null
        }
        return uri
    }
}
