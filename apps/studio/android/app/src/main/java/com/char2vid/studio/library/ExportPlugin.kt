package com.char2vid.studio.library

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native media export bridge (G3).
 *
 * Intended save transaction (not yet proven on device — UNVERIFIED):
 * 1. resolve immutable revision -> open source stream
 * 2. create pending MediaStore destination or user-selected SAF destination
 * 3. copy and verify byte count -> publish destination -> return saved
 * 4. if user cancels picker -> return cancelled
 * 5. if copy fails -> remove incomplete destination -> preserve source -> error
 *
 * Sharing should use FileProvider / temporary content-URI grants. Opening a
 * share chooser is not proof the recipient received the file.
 *
 * This skeleton compiles and is registered with Capacitor. Physical MediaStore /
 * SAF / deny flows remain UNVERIFIED until Kotlin/Room library storage can
 * resolve revision bytes on device.
 */
@CapacitorPlugin(name = "Char2vidExport")
class ExportPlugin : Plugin() {
    @PluginMethod
    fun exportRevision(call: PluginCall) {
        val revisionId = call.getString("revisionId")
        val destination = call.getString("destination")

        if (revisionId.isNullOrBlank()) {
            call.reject("exportRevision requires revisionId")
            return
        }
        if (destination.isNullOrBlank()) {
            call.reject("exportRevision requires destination")
            return
        }
        when (destination) {
            "gallery", "files", "share" -> {
                // Honest stub: native save path not wired to library streams yet.
                // Returning cancelled matches a dismissed picker rather than a false "saved".
                val result = JSObject()
                result.put("status", "cancelled")
                result.put(
                    "displayName",
                    "UNVERIFIED: MediaStore/SAF export not implemented ($destination)",
                )
                call.resolve(result)
            }
            else -> call.reject("unsupported export destination: $destination")
        }
    }
}
