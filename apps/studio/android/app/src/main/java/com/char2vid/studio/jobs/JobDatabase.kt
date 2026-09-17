package com.char2vid.studio.jobs

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [DeviceJobEntity::class], version = 2, exportSchema = false)
abstract class JobDatabase : RoomDatabase() {
    abstract fun jobs(): DeviceJobDao

    companion object {
        @Volatile
        private var instance: JobDatabase? = null

        private val MIGRATION_1_2 =
            object : Migration(1, 2) {
                override fun migrate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        "ALTER TABLE device_jobs ADD COLUMN characterSlotJson TEXT",
                    )
                }
            }

        fun getInstance(context: Context): JobDatabase {
            val existing = instance
            if (existing != null) {
                return existing
            }
            return synchronized(this) {
                instance
                    ?: Room.databaseBuilder(
                            context.applicationContext,
                            JobDatabase::class.java,
                            "char2vid-jobs.db",
                        )
                        .addMigrations(MIGRATION_1_2)
                        .allowMainThreadQueries()
                        .build()
                        .also { instance = it }
            }
        }

        fun clearInstanceForTests() {
            synchronized(this) {
                instance?.close()
                instance = null
            }
        }
    }
}
