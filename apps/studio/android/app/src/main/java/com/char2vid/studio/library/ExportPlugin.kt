package com.char2vid.studio.library

import android.app.Activity
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * Native media export bridge (G3). Typed request `{ revisionId, destination }`
 * only — JavaScript never supplies paths or bytes.
 *
 * Results: `saved` (gallery/files copy verified and published), `shared`
 * (share sheet handed off — never proof of receipt), `cancelled` (picker
 * dismissed). Failures reject with a structured `code` from [LibraryException].
 *
 * `gallery` uses MediaStore `IS_PENDING` on API 29+. On API 26–28 it uses the
 * legacy public directory only when WRITE_EXTERNAL_STORAGE is granted; otherwise,
 * and for non-media kinds, it falls back to the SAF `ACTION_CREATE_DOCUMENT` flow.
 */
@CapacitorPlugin(name = "Char2vidExport")
class ExportPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile
    private var exporter: MediaExporter? = null

    private fun exporter(): MediaExporter {
        val existing = exporter
        if (existing != null) {
            return existing
        }
        synchronized(this) {
            val again = exporter
            if (again != null) {
                return again
            }
            val app = context.applicationContext
            val createdRepo = MediaStoreRepository(app)
            createdRepo.reconcileOnStart()
            val created = MediaExporter(app, createdRepo)
            exporter = created
            return created
        }
    }

    @PluginMethod
    fun exportRevision(call: PluginCall) {
        val revisionId = call.getString("revisionId")
        val destination = call.getString("destination")
        if (revisionId.isNullOrBlank()) {
            call.reject("exportRevision requires revisionId", LibraryException.INVALID_ARGUMENT)
            return
        }
        if (destination.isNullOrBlank()) {
            call.reject("exportRevision requires destination", LibraryException.INVALID_ARGUMENT)
            return
        }
        when (destination) {
            "gallery" -> exportGallery(call, revisionId)
            "files" -> launchCreateDocument(call, revisionId)
            "share" -> share(call, revisionId)
            else -> call.reject("unsupported export destination: $destination", LibraryException.UNSUPPORTED_DESTINATION)
        }
    }

    private fun exportGallery(call: PluginCall, revisionId: String) {
        executor.execute {
            try {
                val exporter = exporter()
                val source = exporter.resolveSource(revisionId)
                if (!exporter.galleryUsesMediaStore(source.kind)) {
                    // API 26–28 without the legacy grant, or a non-media kind: SAF instead.
                    launchCreateDocument(call, revisionId)
                    return@execute
                }
                val saved = exporter.exportToGallery(revisionId)
                call.resolve(savedResult(saved))
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    private fun launchCreateDocument(call: PluginCall, revisionId: String) {
        executor.execute {
            try {
                val intent = exporter().createDocumentIntent(revisionId)
                runOnUiThread(call) {
                    startActivityForResult(call, intent, "onCreateDocumentResult")
                }
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    private fun runOnUiThread(call: PluginCall, block: () -> Unit) {
        val host = activity
        if (host == null) {
            call.reject("no foreground activity", LibraryException.NO_ACTIVITY)
            return
        }
        host.runOnUiThread {
            try {
                block()
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    @ActivityCallback
    private fun onCreateDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            return
        }
        val revisionId = call.getString("revisionId")
        if (revisionId.isNullOrBlank()) {
            call.reject("missing revisionId on picker result", LibraryException.INVALID_ARGUMENT)
            return
        }
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        executor.execute {
            try {
                when (val outcome = exporter().completeSafExport(revisionId, uri)) {
                    is MediaExporter.Outcome.Saved -> call.resolve(savedResult(outcome))
                    is MediaExporter.Outcome.Cancelled -> call.resolve(cancelledResult())
                    is MediaExporter.Outcome.Shared -> call.resolve(sharedResult(outcome))
                }
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    private fun share(call: PluginCall, revisionId: String) {
        executor.execute {
            var shared: MediaExporter.Outcome.Shared? = null
            try {
                val exporter = exporter()
                shared = exporter.prepareShare(revisionId)
                val host = activity
                if (host == null) {
                    exporter.discardShare(shared)
                    call.reject("no foreground activity for share sheet", LibraryException.NO_ACTIVITY)
                    return@execute
                }
                val prepared = shared
                host.runOnUiThread {
                    try {
                        host.startActivity(exporter.buildShareChooser(prepared))
                        call.resolve(sharedResult(prepared))
                    } catch (error: Exception) {
                        exporter.discardShare(prepared)
                        rejectWith(call, error)
                    }
                }
            } catch (error: Exception) {
                shared?.let { exporter().discardShare(it) }
                rejectWith(call, error)
            }
        }
    }

    private fun savedResult(saved: MediaExporter.Outcome.Saved): JSObject {
        val result = JSObject()
        result.put("status", "saved")
        result.put("displayName", saved.displayName)
        return result
    }

    private fun sharedResult(shared: MediaExporter.Outcome.Shared): JSObject {
        val result = JSObject()
        result.put("status", "shared")
        result.put("displayName", shared.displayName)
        return result
    }

    private fun cancelledResult(): JSObject {
        val result = JSObject()
        result.put("status", "cancelled")
        return result
    }

    private fun rejectWith(call: PluginCall, error: Exception) {
        if (error is LibraryException) {
            call.reject(error.message ?: error.code, error.code, error)
        } else {
            call.reject(error.message ?: "export failed", LibraryException.COPY_FAILED, error)
        }
    }
}
