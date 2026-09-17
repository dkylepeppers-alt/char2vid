package com.char2vid.studio.jobs

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface DeviceJobDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insert(job: DeviceJobEntity)

    @Update
    fun update(job: DeviceJobEntity)

    @Query("SELECT * FROM device_jobs WHERE id = :id")
    fun get(id: String): DeviceJobEntity?

    @Query("SELECT * FROM device_jobs WHERE clientRequestId = :clientRequestId")
    fun getByClientRequestId(clientRequestId: String): DeviceJobEntity?

    @Query("SELECT * FROM device_jobs ORDER BY createdAtMs DESC")
    fun listNewest(): List<DeviceJobEntity>

    @Query(
        """
        SELECT * FROM device_jobs
        WHERE providerState = 'queued'
        ORDER BY createdAtMs ASC
        LIMIT 1
        """,
    )
    fun nextQueued(): DeviceJobEntity?

    @Query(
        """
        SELECT * FROM device_jobs
        WHERE providerState = 'running' AND (nextPollAtMs IS NULL OR nextPollAtMs <= :nowMs)
        ORDER BY nextPollAtMs ASC
        LIMIT 1
        """,
    )
    fun nextDuePoll(nowMs: Long): DeviceJobEntity?

    @Query("SELECT * FROM device_jobs WHERE providerState = 'submitting'")
    fun listSubmitting(): List<DeviceJobEntity>

    @Query(
        """
        SELECT COUNT(*) FROM device_jobs
        WHERE providerState IN ('queued', 'submitting', 'running')
        """,
    )
    fun activeCount(): Int
}
