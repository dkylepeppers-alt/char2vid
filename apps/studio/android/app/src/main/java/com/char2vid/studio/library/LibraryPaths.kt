package com.char2vid.studio.library

/**
 * Content-addressed layout for app-owned library files (not Android MediaStore).
 * Matches the web adapter paths used by `@char2vid/storage-web`.
 */
object LibraryPaths {
    fun tempRelativePath(importId: String): String = "tmp/$importId"

    fun finalRelativePath(sha256: String): String {
        require(sha256.length >= 2) { "sha256 too short" }
        return "objects/${sha256.substring(0, 2)}/$sha256"
    }
}
