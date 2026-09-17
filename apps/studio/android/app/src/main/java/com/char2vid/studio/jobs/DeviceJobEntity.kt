package com.char2vid.studio.jobs

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "device_jobs", indices = [Index(value = ["clientRequestId"], unique = true)])
data class DeviceJobEntity(
    @PrimaryKey val id: String,
    val clientRequestId: String,
    val operation: String,
    val requestUrl: String,
    val requestMethod: String,
    val requestBodyJson: String,
    val providerState: String,
    val saveState: String,
    val providerRunId: String?,
    val errorCode: String?,
    val pollCount: Int,
    val nextPollAtMs: Long?,
    val outputJson: String?,
    val characterSlotJson: String?,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

fun DeviceJobEntity.toModel(): DeviceJob =
    DeviceJob(
        id = id,
        clientRequestId = clientRequestId,
        operation = operation,
        requestUrl = requestUrl,
        requestMethod = requestMethod,
        requestBodyJson = requestBodyJson,
        providerState = providerState,
        saveState = saveState,
        providerRunId = providerRunId,
        errorCode = errorCode,
        pollCount = pollCount,
        nextPollAtMs = nextPollAtMs,
        outputJson = outputJson,
        characterSlotJson = characterSlotJson,
        createdAtMs = createdAtMs,
        updatedAtMs = updatedAtMs,
    )

fun DeviceJob.toEntity(): DeviceJobEntity =
    DeviceJobEntity(
        id = id,
        clientRequestId = clientRequestId,
        operation = operation,
        requestUrl = requestUrl,
        requestMethod = requestMethod,
        requestBodyJson = requestBodyJson,
        providerState = providerState,
        saveState = saveState,
        providerRunId = providerRunId,
        errorCode = errorCode,
        pollCount = pollCount,
        nextPollAtMs = nextPollAtMs,
        outputJson = outputJson,
        characterSlotJson = characterSlotJson,
        createdAtMs = createdAtMs,
        updatedAtMs = updatedAtMs,
    )
