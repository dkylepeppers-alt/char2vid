package com.char2vid.studio.library

/**
 * Testable SAF picker result parsing. [LibraryPlugin] maps the activity
 * result onto these values; JVM tests cover cancel / empty / single /
 * multi-select without driving the system document UI.
 */
object DocumentPickerSelection {
    /** [android.app.Activity.RESULT_OK] */
    const val RESULT_OK = -1

    fun cancelled(resultCode: Int, uris: List<String>): Boolean =
        resultCode != RESULT_OK || uris.isEmpty()

    /**
     * @param clipUris non-null when `Intent.clipData` is present (including
     *   an empty clip). Null means fall back to `Intent.data`.
     */
    fun collectUris(clipUris: List<String?>?, singleUri: String?): List<String> {
        if (clipUris != null) {
            return clipUris.mapNotNull { uri -> uri?.takeIf(String::isNotBlank) }
        }
        return listOfNotNull(singleUri?.takeIf(String::isNotBlank))
    }
}
