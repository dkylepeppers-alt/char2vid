package com.char2vid.studio.jobs

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed Nano-GPT API key. Separate from the service-session blob.
 * Physical-device Keystore round-trip remains UNVERIFIED.
 */
class ProviderKeyStore(context: Context) {
    private val prefs =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(apiKey: String) {
        val trimmed = apiKey.trim()
        require(trimmed.isNotEmpty()) { "provider key is empty" }
        val payload = JSONObject()
        payload.put("apiKey", trimmed)
        payload.put("last4", trimmed.takeLast(4))
        prefs.edit().putString(KEY_BLOB, encrypt(payload.toString())).apply()
    }

    fun load(): String? {
        val json = readJson() ?: return null
        val key = json.optString("apiKey")
        return key.takeIf { it.isNotBlank() }
    }

    fun last4(): String? {
        val json = readJson() ?: return null
        val last4 = json.optString("last4")
        return last4.takeIf { it.isNotBlank() }
    }

    fun hasKey(): Boolean = load() != null

    fun clear() {
        prefs.edit().remove(KEY_BLOB).apply()
    }

    private fun readJson(): JSONObject? {
        val blob = prefs.getString(KEY_BLOB, null) ?: return null
        if (blob.isBlank()) {
            return null
        }
        return JSONObject(decrypt(blob))
    }

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
            throw IllegalStateException("provider key blob too short")
        }
        val iv = packed.copyOfRange(0, 12)
        val ciphertext = packed.copyOfRange(12, packed.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "char2vid.provider.key"
        private const val PREFS = "char2vid.provider.key"
        private const val KEY_BLOB = "blob"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
