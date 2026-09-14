package com.char2vid.studio.library

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** Stream helpers that reject unbounded copies before they fill the device. */
object StreamLimits {
    class LimitExceededException(message: String) : IOException(message)

    fun copyBounded(input: InputStream, output: OutputStream, maxBytes: Long): Long {
        require(maxBytes >= 0L) { "maxBytes must be non-negative" }
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) {
                break
            }
            if (read == 0) {
                continue
            }
            val room = maxBytes - total
            if (read > room) {
                if (room > 0L) {
                    output.write(buffer, 0, room.toInt())
                    total += room
                }
                throw LimitExceededException("source exceeds $maxBytes bytes")
            }
            output.write(buffer, 0, read)
            total += read
        }
        return total
    }
}
