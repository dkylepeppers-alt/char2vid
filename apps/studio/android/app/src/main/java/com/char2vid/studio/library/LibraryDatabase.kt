package com.char2vid.studio.library

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        PhysicalObjectEntity::class,
        ImportJournalEntity::class,
        AssetEntity::class,
        RevisionEntity::class,
        CollectionMemberEntity::class,
        AssetTagEntity::class,
        CharacterEntity::class,
        CharacterRevisionEntity::class,
        LookEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class LibraryDatabase : RoomDatabase() {
    abstract fun libraryDao(): LibraryDao

    companion object {
        val MIGRATION_1_2 =
            object : Migration(1, 2) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        """
                        CREATE TABLE IF NOT EXISTS characters (
                          id TEXT NOT NULL,
                          name TEXT NOT NULL,
                          current_revision_id TEXT NOT NULL,
                          cover_asset_revision_id TEXT,
                          created_at TEXT NOT NULL,
                          PRIMARY KEY(id)
                        )
                        """.trimIndent(),
                    )
                    db.execSQL("CREATE INDEX IF NOT EXISTS index_characters_created_at ON characters(created_at)")
                    db.execSQL("CREATE INDEX IF NOT EXISTS index_characters_name ON characters(name)")
                    db.execSQL(
                        """
                        CREATE TABLE IF NOT EXISTS character_revisions (
                          id TEXT NOT NULL,
                          character_id TEXT NOT NULL,
                          parent_revision_id TEXT,
                          identity_notes TEXT NOT NULL,
                          references_json TEXT NOT NULL,
                          PRIMARY KEY(id)
                        )
                        """.trimIndent(),
                    )
                    db.execSQL(
                        "CREATE INDEX IF NOT EXISTS index_character_revisions_character_id ON character_revisions(character_id)",
                    )
                    db.execSQL(
                        """
                        CREATE TABLE IF NOT EXISTS looks (
                          id TEXT NOT NULL,
                          character_id TEXT NOT NULL,
                          label TEXT NOT NULL,
                          notes TEXT NOT NULL,
                          reference_revision_ids_json TEXT NOT NULL,
                          PRIMARY KEY(id)
                        )
                        """.trimIndent(),
                    )
                    db.execSQL("CREATE INDEX IF NOT EXISTS index_looks_character_id ON looks(character_id)")
                }
            }

        @Volatile
        private var instance: LibraryDatabase? = null

        fun getInstance(context: Context): LibraryDatabase {
            val existing = instance
            if (existing != null) {
                return existing
            }
            return synchronized(this) {
                instance
                    ?: Room.databaseBuilder(
                            context.applicationContext,
                            LibraryDatabase::class.java,
                            "char2vid-library.db",
                        )
                        .addMigrations(MIGRATION_1_2)
                        .fallbackToDestructiveMigration()
                        .build()
                        .also { instance = it }
            }
        }

        /** Test helper: reset singleton between instrumented runs. */
        fun clearInstanceForTests() {
            synchronized(this) {
                instance?.close()
                instance = null
            }
        }
    }
}
