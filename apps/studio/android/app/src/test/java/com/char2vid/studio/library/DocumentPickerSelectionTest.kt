package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentPickerSelectionTest {
    @Test
    fun cancelAndEmptyAreCancelled() {
        assertTrue(DocumentPickerSelection.cancelled(0, listOf("content://one")))
        assertTrue(DocumentPickerSelection.cancelled(DocumentPickerSelection.RESULT_OK, emptyList()))
        assertFalse(
            DocumentPickerSelection.cancelled(
                DocumentPickerSelection.RESULT_OK,
                listOf("content://one"),
            ),
        )
    }

    @Test
    fun collectSingleDataUri() {
        assertEquals(
            listOf("content://single"),
            DocumentPickerSelection.collectUris(null, "content://single"),
        )
    }

    @Test
    fun collectClipDataDoesNotFallThroughToData() {
        assertEquals(
            listOf("content://a", "content://b"),
            DocumentPickerSelection.collectUris(
                listOf("content://a", null, "content://b", ""),
                "content://ignored",
            ),
        )
        assertEquals(
            emptyList<String>(),
            DocumentPickerSelection.collectUris(emptyList(), "content://ignored"),
        )
    }
}
