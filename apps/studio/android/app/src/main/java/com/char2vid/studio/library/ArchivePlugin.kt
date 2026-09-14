package com.char2vid.studio.library

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Native portable archive bridge (G4).
 *
 * Intended behavior (UNVERIFIED on device):
 * - exportArchive streams manifest.json + records.json + media/ blobs through a
 *   SAF / app-storage writer without holding the whole archive in JS memory
 * - inspectArchive validates paths, counts, expanded size, and checksums
 *   before any library mutation
 * - importArchive stages into a rollback-safe transaction with ID remapping
 *
 * This skeleton compiles and registers with Capacitor. Physical Android↔Android
 * and browser↔Android round trips remain UNVERIFIED until Room/files library
 * storage can resolve revision streams on device.
 */
@CapacitorPlugin(name = "Char2vidArchive")
class ArchivePlugin : Plugin() {
    @PluginMethod
    fun exportArchive(call: PluginCall) {
        val scope = call.getString("scope")
        if (scope.isNullOrBlank()) {
            call.reject("exportArchive requires scope")
            return
        }
        val result = JSObject()
        // Label clearly — skeleton never performed a real transfer.
        result.put("transferId", "UNVERIFIED-native-export-stub")
        result.put("status", "unverified")
        result.put(
            "detail",
            "UNVERIFIED: native archive export not wired to library streams ($scope)",
        )
        call.resolve(result)
    }

    @PluginMethod
    fun inspectArchive(call: PluginCall) {
        val result = JSObject()
        result.put("fileCount", 0)
        result.put("expandedBytes", 0)
        result.put("ok", false)
        result.put("status", "unverified")
        result.put(
            "detail",
            "UNVERIFIED: native archive inspect not implemented",
        )
        call.resolve(result)
    }

    @PluginMethod
    fun importArchive(call: PluginCall) {
        val conflict = call.getString("conflict")
        if (conflict != "remap") {
            call.reject("importArchive requires conflict=remap")
            return
        }
        val result = JSObject()
        result.put("idMap", JSObject())
        result.put("status", "unverified")
        result.put(
            "detail",
            "UNVERIFIED: native archive import not wired to library streams",
        )
        call.resolve(result)
    }
}
