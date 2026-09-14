package com.char2vid.studio.library

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Native portable archive bridge (G4). Streams ZIP members through
 * [LibraryArchiver] — JavaScript never supplies archive bytes or paths.
 *
 * `exportArchive({ scope: 'library', destination?: 'files' | 'share' })`
 * writes a verified scratch ZIP, then publishes to a SAF document or a
 * FileProvider share URI. Interrupted exports never leave an apparently
 * complete archive.
 *
 * `inspectArchive` / `importArchive` open a user-selected SAF document
 * (or a `content:`/`file:` URI the picker already granted). Inspect never
 * mutates the library. Import remaps colliding IDs and rolls back on failure.
 *
 * `scope: 'project' | 'character'` rejects with `unsupported_scope`.
 */
@CapacitorPlugin(name = "Char2vidArchive")
class ArchivePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile
    private var archiver: LibraryArchiver? = null

    @Volatile
    private var repo: MediaStoreRepository? = null

    private fun repo(): MediaStoreRepository {
        val existing = repo
        if (existing != null) {
            return existing
        }
        synchronized(this) {
            val again = repo
            if (again != null) {
                return again
            }
            val app = context.applicationContext
            val created = MediaStoreRepository(app)
            created.reconcileOnStart()
            repo = created
            return created
        }
    }

    private fun archiver(): LibraryArchiver {
        val existing = archiver
        if (existing != null) {
            return existing
        }
        synchronized(this) {
            val again = archiver
            if (again != null) {
                return again
            }
            val created = LibraryArchiver(context.applicationContext, repo())
            archiver = created
            return created
        }
    }

    @PluginMethod
    fun exportArchive(call: PluginCall) {
        val scope = call.getString("scope")
        if (scope.isNullOrBlank()) {
            call.reject("exportArchive requires scope", LibraryException.INVALID_ARGUMENT)
            return
        }
        if (scope != "library") {
            call.reject(
                "archive scope \"$scope\" is not supported",
                LibraryException.UNSUPPORTED_SCOPE,
            )
            return
        }
        val id = call.getString("id")
        if (!id.isNullOrBlank()) {
            call.reject("library-scope export does not accept an id", LibraryException.INVALID_ARGUMENT)
            return
        }
        val destination = call.getString("destination") ?: "files"
        when (destination) {
            "files" -> launchCreateDocument(call)
            "share" -> shareArchive(call)
            else ->
                call.reject(
                    "unsupported archive destination: $destination",
                    LibraryException.UNSUPPORTED_DESTINATION,
                )
        }
    }

    @PluginMethod
    fun inspectArchive(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri.isNullOrBlank()) {
            launchOpenDocument(call, "onInspectDocumentResult")
            return
        }
        executor.execute {
            try {
                call.resolve(reportToJs(archiver().inspect { openUri(uri) }, uri))
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    @PluginMethod
    fun importArchive(call: PluginCall) {
        val conflict = call.getString("conflict")
        if (conflict != "remap") {
            call.reject("importArchive requires conflict=remap", LibraryException.INVALID_ARGUMENT)
            return
        }
        val uri = call.getString("uri")
        if (uri.isNullOrBlank()) {
            launchOpenDocument(call, "onImportDocumentResult")
            return
        }
        runImport(call, uri)
    }

    private fun launchCreateDocument(call: PluginCall) {
        val transferId = UUID.randomUUID().toString()
        call.data.put("transferId", transferId)
        runOnUiThread(call) {
            val intent =
                Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/zip"
                    putExtra(Intent.EXTRA_TITLE, archiver().fileNameFor(transferId))
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            startActivityForResult(call, intent, "onExportDocumentResult")
        }
    }

    private fun launchOpenDocument(call: PluginCall, callbackName: String) {
        runOnUiThread(call) {
            val intent =
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/zip"
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf("application/zip", "application/octet-stream"),
                    )
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            startActivityForResult(call, intent, callbackName)
        }
    }

    @ActivityCallback
    private fun onExportDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            return
        }
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            call.resolve(exportResult(call.getString("transferId") ?: "", null, "cancelled"))
            return
        }
        executor.execute {
            var scratch: File? = null
            try {
                val transferId = call.getString("transferId") ?: UUID.randomUUID().toString()
                val (file, summary) = archiver().exportLibraryToScratch(transferId)
                scratch = file
                copyFileToUri(file, uri)
                file.parentFile?.deleteRecursively()
                scratch = null
                call.resolve(exportResult(summary.transferId, summary.fileName, "ready"))
            } catch (error: Exception) {
                scratch?.parentFile?.deleteRecursively()
                deleteDocumentQuietly(uri)
                rejectWith(call, error)
            }
        }
    }

    @ActivityCallback
    private fun onInspectDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            return
        }
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            call.resolve(cancelledInspect())
            return
        }
        executor.execute {
            try {
                val report = archiver().inspect { openUri(uri.toString()) }
                call.resolve(reportToJs(report, uri.toString()))
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    @ActivityCallback
    private fun onImportDocumentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            return
        }
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            val cancelled = JSObject()
            cancelled.put("idMap", JSObject())
            cancelled.put("status", "cancelled")
            call.resolve(cancelled)
            return
        }
        runImport(call, uri.toString())
    }

    private fun runImport(call: PluginCall, uri: String) {
        executor.execute {
            try {
                val imported = archiver().importArchive({ openUri(uri) }, "remap")
                val result = JSObject()
                val idMap = JSObject()
                for ((from, to) in imported.idMap) {
                    idMap.put(from, to)
                }
                result.put("idMap", idMap)
                result.put("status", "imported")
                result.put("importedAssets", imported.importedAssets)
                call.resolve(result)
            } catch (error: Exception) {
                rejectWith(call, error)
            }
        }
    }

    private fun shareArchive(call: PluginCall) {
        executor.execute {
            var scratch: File? = null
            try {
                val transferId = UUID.randomUUID().toString()
                val exporter = MediaExporter(context.applicationContext, repo())
                exporter.pruneStaleShares()
                val (file, summary) = archiver().exportLibraryToScratch(transferId)
                scratch = file
                val dir = File(exporter.shareRoot(), UUID.randomUUID().toString())
                if (!dir.mkdirs() && !dir.isDirectory) {
                    throw LibraryException(
                        LibraryException.DESTINATION_UNAVAILABLE,
                        "unable to create archive share staging directory",
                    )
                }
                val staged = File(dir, summary.fileName)
                FileInputStream(file).use { input ->
                    FileOutputStream(staged).use { output -> input.copyTo(output) }
                }
                file.parentFile?.deleteRecursively()
                scratch = null
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", staged)
                val host = activity
                if (host == null) {
                    dir.deleteRecursively()
                    call.reject("no foreground activity for share sheet", LibraryException.NO_ACTIVITY)
                    return@execute
                }
                host.runOnUiThread {
                    try {
                        host.startActivity(buildShareChooser(uri, summary.fileName))
                        call.resolve(exportResult(summary.transferId, summary.fileName, "ready", "shared"))
                    } catch (error: Exception) {
                        rejectWith(call, error)
                    }
                }
            } catch (error: Exception) {
                scratch?.parentFile?.deleteRecursively()
                rejectWith(call, error)
            }
        }
    }

    private fun buildShareChooser(uri: Uri, displayName: String): Intent {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newUri(context.contentResolver, displayName, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        return Intent.createChooser(send, null).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun copyFileToUri(file: File, uri: Uri) {
        val output =
            if (uri.scheme == "file") {
                val path =
                    uri.path
                        ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "file uri missing path")
                FileOutputStream(File(path))
            } else {
                context.contentResolver.openOutputStream(uri, "wt")
                    ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to open destination")
            }
        BufferedInputStream(FileInputStream(file)).use { input ->
            BufferedOutputStream(output).use { out ->
                val copied = input.copyTo(out)
                out.flush()
                if (copied != file.length()) {
                    throw LibraryException(
                        LibraryException.VERIFICATION_FAILED,
                        "byte count mismatch publishing archive",
                    )
                }
            }
        }
    }

    private fun stringArray(values: List<String>): JSArray {
        val arr = JSArray()
        for (value in values) {
            arr.put(value)
        }
        return arr
    }

    private fun openUri(uriString: String): java.io.InputStream {
        val uri = Uri.parse(uriString)
        val scheme = uri.scheme
        if (scheme != "content" && scheme != "file") {
            throw LibraryException(LibraryException.INVALID_ARGUMENT, "archive source must be a content or file URI")
        }
        if (scheme == "file") {
            val path = uri.path ?: throw LibraryException(LibraryException.INVALID_ARGUMENT, "file uri missing path")
            return FileInputStream(File(path))
        }
        return context.contentResolver.openInputStream(uri)
            ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to open archive source")
    }

    private fun deleteDocumentQuietly(uri: Uri) {
        try {
            if (uri.scheme == "file") {
                uri.path?.let { File(it).delete() }
            } else if (android.provider.DocumentsContract.isDocumentUri(context, uri)) {
                android.provider.DocumentsContract.deleteDocument(context.contentResolver, uri)
            }
        } catch (_: Exception) {
            // best effort; the caller surfaces the original failure
        }
    }

    private fun exportResult(
        transferId: String,
        fileName: String?,
        status: String,
        detail: String? = null,
    ): JSObject {
        val result = JSObject()
        result.put("transferId", transferId)
        if (fileName != null) {
            result.put("fileName", fileName)
        }
        result.put("status", status)
        if (detail != null) {
            result.put("detail", detail)
        }
        return result
    }

    private fun cancelledInspect(): JSObject {
        val result = JSObject()
        result.put("schemaVersion", JSONObject.NULL)
        result.put("fileCount", 0)
        result.put("expandedBytes", 0)
        result.put("ok", false)
        result.put("unsupportedVersion", false)
        result.put("missingFiles", JSArray())
        result.put("invalidPaths", JSArray())
        result.put("errors", JSArray())
        result.put("status", "cancelled")
        return result
    }

    private fun reportToJs(report: ArchiveReport, uri: String?): JSObject {
        val result = JSObject()
        if (report.schemaVersion == null) {
            result.put("schemaVersion", JSONObject.NULL)
        } else {
            result.put("schemaVersion", report.schemaVersion)
        }
        result.put("fileCount", report.fileCount)
        result.put("expandedBytes", report.expandedBytes)
        result.put("ok", report.ok)
        result.put("unsupportedVersion", report.unsupportedVersion)
        result.put("missingFiles", stringArray(report.missingFiles))
        result.put("invalidPaths", stringArray(report.invalidPaths))
        result.put("errors", stringArray(report.errors))
        result.put("status", "ready")
        if (uri != null) {
            result.put("uri", uri)
        }
        return result
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

    private fun rejectWith(call: PluginCall, error: Exception) {
        if (error is LibraryException) {
            call.reject(error.message ?: error.code, error.code, error)
        } else {
            call.reject(error.message ?: "archive operation failed", LibraryException.ARCHIVE_REJECTED, error)
        }
    }
}
