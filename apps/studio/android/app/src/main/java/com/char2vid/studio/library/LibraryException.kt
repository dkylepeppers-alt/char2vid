package com.char2vid.studio.library

/**
 * Structured failure surfaced to JavaScript as `{ message, code }` through
 * `PluginCall.reject(message, code)`. Codes are stable identifiers the UI can
 * branch on; messages are human-readable and never contain secrets or URIs.
 */
class LibraryException(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause) {
    companion object {
        const val UNKNOWN_REVISION = "unknown_revision"
        const val MISSING_FILE = "missing_file"
        const val UNSUPPORTED_DESTINATION = "unsupported_destination"
        const val UNSUPPORTED_SCOPE = "unsupported_scope"
        const val DESTINATION_UNAVAILABLE = "destination_unavailable"
        const val COPY_FAILED = "copy_failed"
        const val EXPORT_FAILED = "export_failed"
        const val VERIFICATION_FAILED = "verification_failed"
        const val ARCHIVE_REJECTED = "archive_rejected"
        const val INVALID_ARGUMENT = "invalid_argument"
        const val NO_ACTIVITY = "no_activity"
    }
}
