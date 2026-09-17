package com.char2vid.studio.jobs

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImageOutputParserTest {
    @Test
    fun readsB64JsonArray() {
        val body =
            JSONObject(
                """{"data":[{"b64_json":"iVBORw=="}]}""",
            )
        val items = ImageOutputParser.parse(body)
        assertEquals(1, items.size)
        assertEquals("iVBORw==", items[0].base64)
        assertNull(items[0].url)
    }

    @Test
    fun mapsCompletedVideoUrl() {
        val body =
            JSONObject(
                """{"data":{"status":"COMPLETED","output":{"video":{"url":"https://cdn.example/v.mp4"}}}}""",
            )
        val status = VideoStatusParser.parse(body)
        assertEquals("completed", status.state)
        assertEquals("https://cdn.example/v.mp4", status.outputUrl)
    }
}
