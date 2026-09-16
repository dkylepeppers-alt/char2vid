package com.char2vid.studio.jobs

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [DeviceJobEntity::class], version = 1, exportSchema = false)
abstract class JobDatabase : RoomDatabase() {
    abstract fun jobs(): DeviceJobDao

    companion object {
        @Volatile
        private var instance: JobDatabase? = null

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
                        .fallbackToDestructiveMigration()
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
