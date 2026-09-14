package com.char2vid.studio.library

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
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

    private fun jsFromJson(json: JSONObject): JSObject {
        // JSObject extends JSONObject; copy via string to satisfy Capacitor typing.
        return JSObject(json.toString())
    }
}
