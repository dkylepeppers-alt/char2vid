package com.char2vid.studio.credentials

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed app-service session storage (P2).
 * Stores only the studio↔service device token — never a Nano-GPT key.
 * Physical-device Keystore round-trip remains UNVERIFIED.
 */
@CapacitorPlugin(name = "Char2vidCredentials")
class CredentialsPlugin : Plugin() {
    @PluginMethod
    fun saveSession(call: PluginCall) {
        val token = call.getString("deviceToken")
        val deviceId = call.getString("deviceId")
        val origin = call.getString("serviceOrigin")
        if (token.isNullOrBlank() || deviceId.isNullOrBlank() || origin.isNullOrBlank()) {
            call.reject("saveSession requires deviceToken, deviceId, and serviceOrigin")
            return
        }
        try {
            val payload = JSObject()
            payload.put("deviceToken", token)
            payload.put("deviceId", deviceId)
            payload.put("serviceOrigin", origin)
            prefs().edit().putString(KEY_BLOB, encrypt(payload.toString())).apply()
            val result = JSObject()
            result.put("stored", true)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject(error.message ?: "saveSession failed", error)
        }
    }

    @PluginMethod
    fun loadSession(call: PluginCall) {
        try {
            val blob = prefs().getString(KEY_BLOB, null)
            val result = JSObject()
            if (blob.isNullOrBlank()) {
                result.put("deviceToken", JSONObject.NULL)
                result.put("deviceId", JSONObject.NULL)
                result.put("serviceOrigin", JSONObject.NULL)
                call.resolve(result)
                return
            }
            val json = JSONObject(decrypt(blob))
            result.put("deviceToken", json.optString("deviceToken"))
            result.put("deviceId", json.optString("deviceId"))
            result.put("serviceOrigin", json.optString("serviceOrigin"))
            call.resolve(result)
        } catch (error: Exception) {
            call.reject(error.message ?: "loadSession failed", error)
        }
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        prefs().edit().remove(KEY_BLOB).apply()
        val result = JSObject()
        result.put("cleared", true)
        call.resolve(result)
    }

    private fun prefs() =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE)
        store.load(null)
        val existing = store.getKey(ALIAS, null) as? SecretKey
        if (existing != null) {
            return existing
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val packed = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, packed, 0, iv.size)
        System.arraycopy(ciphertext, 0, packed, iv.size, ciphertext.size)
        return Base64.encodeToString(packed, Base64.NO_WRAP)
    }

    private fun decrypt(blob: String): String {
        val packed = Base64.decode(blob, Base64.NO_WRAP)
        if (packed.size < 13) {
            throw IllegalStateException("credential blob too short")
        }
        val iv = packed.copyOfRange(0, 12)
        val ciphertext = packed.copyOfRange(12, packed.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "char2vid.service.session"
        private const val PREFS = "char2vid.service.session"
        private const val KEY_BLOB = "blob"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
