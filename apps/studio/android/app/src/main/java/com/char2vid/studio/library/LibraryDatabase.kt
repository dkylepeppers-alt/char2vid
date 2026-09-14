package com.char2vid.studio.library

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        PhysicalObjectEntity::class,
        ImportJournalEntity::class,
        AssetEntity::class,
        RevisionEntity::class,
        CollectionMemberEntity::class,
        AssetTagEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class LibraryDatabase : RoomDatabase() {
    abstract fun libraryDao(): LibraryDao

    companion object {
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
