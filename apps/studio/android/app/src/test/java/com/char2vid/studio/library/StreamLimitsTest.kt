package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class StreamLimitsTest {
    @Test
    fun copiesWhenUnderTheCap() {
        val out = ByteArrayOutputStream()
        val written = StreamLimits.copyBounded(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), out, 4)
        assertEquals(4L, written)
        assertEquals(listOf<Byte>(1, 2, 3, 4), out.toByteArray().toList())
    }

    @Test
    fun stopsBeforeExceedingTheCap() {
        val out = ByteArrayOutputStream()
        try {
            StreamLimits.copyBounded(ByteArrayInputStream(ByteArray(8) { 1 }), out, 4)
            fail("expected LimitExceededException")
        } catch (_: StreamLimits.LimitExceededException) {
            // expected
        }
        assertEquals(4, out.size())
    }
}
