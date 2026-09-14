package com.char2vid.studio.library

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Shared helpers for emulator-backed library tests. No network, no provider calls. */
object InstrumentedFixtures {
    fun targetContext(): Context = InstrumentationRegistry.getInstrumentation().targetContext

    /** Fixture bytes live in the *test* APK's assets (`src/androidTest/assets`). */
    fun fixtureBytes(name: String): ByteArray =
        InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { it.readBytes() }

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun readAll(input: InputStream): ByteArray =
        input.use { stream ->
            val out = ByteArrayOutputStream()
            stream.copyTo(out)
            out.toByteArray()
        }

    /** Fresh Room DB + empty library directory, mirroring a first launch. */
    fun resetLibrary(context: Context): MediaStoreRepository {
        LibraryDatabase.clearInstanceForTests()
        File(context.filesDir, "library").deleteRecursively()
        context.deleteDatabase("char2vid-library.db")
        return MediaStoreRepository(context)
    }

    /** Import a fixture PNG through the real journaled path via a file:// URI. */
    fun importFixture(
        context: Context,
        repo: MediaStoreRepository,
        fixture: String,
        displayName: String = fixture,
    ): MediaStoreRepository.AssetRecordDto {
        val source = File(context.cacheDir, "fixture-${System.nanoTime()}-$fixture")
        source.writeBytes(fixtureBytes(fixture))
        try {
            return repo.importFromNativeUri(source.toURI().toString(), displayName, "image/png")
        } finally {
            source.delete()
        }
    }

    fun tempEntries(context: Context): List<String> =
        File(File(context.filesDir, "library"), "tmp").listFiles()?.map { it.name } ?: emptyList()
}
