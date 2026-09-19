package com.char2vid.studio.library

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Capacitor bridge for G2 native Room library storage.
 *
 * Typed commands only — no unrestricted SQL from the WebView.
 * Physical-device import/close/reopen hash proof remains UNVERIFIED until
 * instrumentation runs on hardware or a CI emulator job.
 */
@CapacitorPlugin(name = "Char2vidLibrary")
class LibraryPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile
    private var repository: MediaStoreRepository? = null

    private fun repo(): MediaStoreRepository {
        val existing = repository
        if (existing != null) {
            return existing
        }
        synchronized(this) {
            val again = repository
            if (again != null) {
                return again
            }
            val created = MediaStoreRepository(context.applicationContext)
            created.reconcileOnStart()
            repository = created
            return created
        }
    }

    @PluginMethod
    fun pickAndImport(call: PluginCall) {
        val host = activity
        if (host == null) {
            call.reject("no foreground activity")
            return
        }
        host.runOnUiThread {
            try {
                val intent =
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(
                            Intent.EXTRA_MIME_TYPES,
                            arrayOf("image/*", "video/*", "audio/*"),
                        )
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                startActivityForResult(call, intent, "onPickMediaResult")
            } catch (error: Exception) {
                call.reject(error.message ?: "pickAndImport failed", error)
            }
        }
    }

    @ActivityCallback
    private fun onPickMediaResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            return
        }
        val data = result.data
        val clip = data?.clipData
        val clipUris =
            if (clip != null) {
                (0 until clip.itemCount).map { index -> clip.getItemAt(index).uri?.toString() }
            } else {
                null
            }
        val uris = DocumentPickerSelection.collectUris(clipUris, data?.data?.toString())
        if (DocumentPickerSelection.cancelled(result.resultCode, uris)) {
            val empty = JSObject()
            empty.put("status", "cancelled")
            empty.put("assets", JSArray())
            call.resolve(empty)
            return
        }
        executor.execute {
            try {
                val assets = JSArray()
                for (uriString in uris) {
                    val uri = Uri.parse(uriString)
                    val name = queryDisplayName(uri) ?: "import.bin"
                    val mime = resolveMime(uri, name)
                    val asset = repo().importFromNativeUri(uriString, name, mime)
                    assets.put(jsFromJson(asset.toJson()))
                }
                val payload = JSObject()
                payload.put("status", "imported")
                payload.put("assets", assets)
                call.resolve(payload)
            } catch (error: Exception) {
                call.reject(error.message ?: "pickAndImport failed", error)
            }
        }
    }

    @PluginMethod
    fun importFromNativeUri(call: PluginCall) {
        val uri = call.getString("uri")
        val name = call.getString("name")
        val mime = call.getString("mime")
        if (uri.isNullOrBlank()) {
            call.reject("importFromNativeUri requires uri")
            return
        }
        if (name.isNullOrBlank()) {
            call.reject("importFromNativeUri requires name")
            return
        }
        if (mime.isNullOrBlank()) {
            call.reject("importFromNativeUri requires mime")
            return
        }
        executor.execute {
            try {
                val asset = repo().importFromNativeUri(uri, name, mime)
                call.resolve(jsFromJson(asset.toJson()))
            } catch (error: Exception) {
                call.reject(error.message ?: "importFromNativeUri failed", error)
            }
        }
    }

    @PluginMethod
    fun beginByteImport(call: PluginCall) {
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().beginByteImport()))
            } catch (error: Exception) {
                call.reject(error.message ?: "beginByteImport failed", error)
            }
        }
    }

    @PluginMethod
    fun appendByteImportChunk(call: PluginCall) {
        val writeId = call.getString("writeId")
        val data = call.getString("data")
        if (writeId.isNullOrBlank()) {
            call.reject("appendByteImportChunk requires writeId")
            return
        }
        if (data.isNullOrBlank()) {
            call.reject("appendByteImportChunk requires data")
            return
        }
        executor.execute {
            try {
                repo().appendByteImportChunk(writeId, data)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "appendByteImportChunk failed", error)
            }
        }
    }

    @PluginMethod
    fun abandonByteImport(call: PluginCall) {
        val writeId = call.getString("writeId")
        if (writeId.isNullOrBlank()) {
            call.reject("abandonByteImport requires writeId")
            return
        }
        executor.execute {
            try {
                repo().abandonByteImport(writeId)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "abandonByteImport failed", error)
            }
        }
    }

    @PluginMethod
    fun importFromBytes(call: PluginCall) {
        val data = call.getString("data")
        val name = call.getString("name")
        val mime = call.getString("mime")
        if (data.isNullOrBlank()) {
            call.reject("importFromBytes requires data")
            return
        }
        if (name.isNullOrBlank()) {
            call.reject("importFromBytes requires name")
            return
        }
        if (mime.isNullOrBlank()) {
            call.reject("importFromBytes requires mime")
            return
        }
        executor.execute {
            try {
                val asset = repo().importFromBytes(data, name, mime)
                call.resolve(jsFromJson(asset.toJson()))
            } catch (error: Exception) {
                call.reject(error.message ?: "importFromBytes failed", error)
            }
        }
    }

    @PluginMethod
    fun getAsset(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("getAsset requires id")
            return
        }
        executor.execute {
            try {
                val asset = repo().getAsset(id)
                if (asset == null) {
                    val empty = JSObject()
                    empty.put("asset", org.json.JSONObject.NULL)
                    call.resolve(empty)
                } else {
                    val result = JSObject()
                    result.put("asset", jsFromJson(asset.toJson()))
                    call.resolve(result)
                }
            } catch (error: Exception) {
                call.reject(error.message ?: "getAsset failed", error)
            }
        }
    }

    @PluginMethod
    fun openRevisionRead(call: PluginCall) {
        val revisionId = call.getString("revisionId")
        if (revisionId.isNullOrBlank()) {
            call.reject("openRevisionRead requires revisionId")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().openRevisionRead(revisionId)))
            } catch (error: Exception) {
                call.reject(error.message ?: "openRevisionRead failed", error)
            }
        }
    }

    @PluginMethod
    fun readRevisionChunk(call: PluginCall) {
        val readId = call.getString("readId")
        val maxBytes = call.getInt("maxBytes") ?: (256 * 1024)
        if (readId.isNullOrBlank()) {
            call.reject("readRevisionChunk requires readId")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().readRevisionChunk(readId, maxBytes)))
            } catch (error: Exception) {
                call.reject(error.message ?: "readRevisionChunk failed", error)
            }
        }
    }

    @PluginMethod
    fun closeRevisionRead(call: PluginCall) {
        val readId = call.getString("readId")
        if (readId.isNullOrBlank()) {
            call.reject("closeRevisionRead requires readId")
            return
        }
        executor.execute {
            try {
                repo().closeRevisionRead(readId)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "closeRevisionRead failed", error)
            }
        }
    }

    @PluginMethod
    fun reconcileImports(call: PluginCall) {
        executor.execute {
            try {
                val result = repo().reconcileImports()
                val o = JSObject()
                o.put("repaired", result.repaired)
                val missing = JSArray()
                for (id in result.missing) {
                    missing.put(id)
                }
                o.put("missing", missing)
                call.resolve(o)
            } catch (error: Exception) {
                call.reject(error.message ?: "reconcileImports failed", error)
            }
        }
    }

    @PluginMethod
    fun storageUsage(call: PluginCall) {
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().storageUsage()))
            } catch (error: Exception) {
                call.reject(error.message ?: "storageUsage failed", error)
            }
        }
    }

    @PluginMethod
    fun queryAssets(call: PluginCall) {
        val raw = call.data ?: JSObject()
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().queryAssets(raw)))
            } catch (error: Exception) {
                call.reject(error.message ?: "queryAssets failed", error)
            }
        }
    }

    @PluginMethod
    fun applyLibraryAction(call: PluginCall) {
        val raw = call.data ?: JSObject()
        executor.execute {
            try {
                repo().applyLibraryAction(raw)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "applyLibraryAction failed", error)
            }
        }
    }

    @PluginMethod
    fun createCharacter(call: PluginCall) {
        val name = call.getString("name")
        val referenceRevisionId = call.getString("referenceRevisionId")
        if (name.isNullOrBlank()) {
            call.reject("createCharacter requires name")
            return
        }
        if (referenceRevisionId.isNullOrBlank()) {
            call.reject("createCharacter requires referenceRevisionId")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().createCharacter(name, referenceRevisionId)))
            } catch (error: Exception) {
                call.reject(error.message ?: "createCharacter failed", error)
            }
        }
    }

    @PluginMethod
    fun listCharacters(call: PluginCall) {
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().listCharacters()))
            } catch (error: Exception) {
                call.reject(error.message ?: "listCharacters failed", error)
            }
        }
    }

    @PluginMethod
    fun getCharacter(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("getCharacter requires id")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().getCharacter(id)))
            } catch (error: Exception) {
                call.reject(error.message ?: "getCharacter failed", error)
            }
        }
    }

    @PluginMethod
    fun listCharacterRevisions(call: PluginCall) {
        val characterId = call.getString("characterId")
        if (characterId.isNullOrBlank()) {
            call.reject("listCharacterRevisions requires characterId")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().listCharacterRevisions(characterId)))
            } catch (error: Exception) {
                call.reject(error.message ?: "listCharacterRevisions failed", error)
            }
        }
    }

    @PluginMethod
    fun getCharacterRevision(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("getCharacterRevision requires id")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().getCharacterRevision(id)))
            } catch (error: Exception) {
                call.reject(error.message ?: "getCharacterRevision failed", error)
            }
        }
    }

    @PluginMethod
    fun saveCharacterRevision(call: PluginCall) {
        val raw = call.data ?: JSObject()
        executor.execute {
            try {
                repo().saveCharacterRevision(raw)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "saveCharacterRevision failed", error)
            }
        }
    }

    @PluginMethod
    fun saveLook(call: PluginCall) {
        val raw = call.data ?: JSObject()
        executor.execute {
            try {
                repo().saveLook(raw)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "saveLook failed", error)
            }
        }
    }

    @PluginMethod
    fun listLooks(call: PluginCall) {
        val characterId = call.getString("characterId")
        if (characterId.isNullOrBlank()) {
            call.reject("listLooks requires characterId")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().listLooks(characterId)))
            } catch (error: Exception) {
                call.reject(error.message ?: "listLooks failed", error)
            }
        }
    }

    @PluginMethod
    fun getLook(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrBlank()) {
            call.reject("getLook requires id")
            return
        }
        executor.execute {
            try {
                call.resolve(jsFromJson(repo().getLook(id)))
            } catch (error: Exception) {
                call.reject(error.message ?: "getLook failed", error)
            }
        }
    }

    @PluginMethod
    fun setCover(call: PluginCall) {
        val characterId = call.getString("characterId")
        val assetRevisionId = call.getString("assetRevisionId")
        if (characterId.isNullOrBlank() || assetRevisionId.isNullOrBlank()) {
            call.reject("setCover requires characterId and assetRevisionId")
            return
        }
        executor.execute {
            try {
                repo().setCover(characterId, assetRevisionId)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "setCover failed", error)
            }
        }
    }

    @PluginMethod
    fun renameCharacter(call: PluginCall) {
        val id = call.getString("id")
        val name = call.getString("name")
        if (id.isNullOrBlank() || name.isNullOrBlank()) {
            call.reject("renameCharacter requires id and name")
            return
        }
        executor.execute {
            try {
                repo().renameCharacter(id, name)
                call.resolve(JSObject())
            } catch (error: Exception) {
                call.reject(error.message ?: "renameCharacter failed", error)
            }
        }
    }

    @PluginMethod
    fun referenceAvailability(call: PluginCall) {
        val assetRevisionId = call.getString("assetRevisionId")
        if (assetRevisionId.isNullOrBlank()) {
            call.reject("referenceAvailability requires assetRevisionId")
            return
        }
        executor.execute {
            try {
                val o = JSObject()
                o.put("availability", repo().referenceAvailability(assetRevisionId))
                call.resolve(o)
            } catch (error: Exception) {
                call.reject(error.message ?: "referenceAvailability failed", error)
            }
        }
    }

    private fun queryDisplayName(uri: Uri): String? {
        val cursor =
            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )
        cursor?.use {
            if (it.moveToFirst()) {
                val index = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    return it.getString(index)
                }
            }
        }
        return uri.lastPathSegment
    }

    private fun resolveMime(uri: Uri, name: String): String {
        val fromResolver = context.contentResolver.getType(uri)
        return MediaMime.resolve(name, fromResolver) { ext ->
            android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        }
    }

    private fun jsFromJson(json: JSONObject): JSObject {
        // JSObject extends JSONObject; copy via string to satisfy Capacitor typing.
        return JSObject(json.toString())
    }
}
