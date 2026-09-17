package com.char2vid.studio.jobs

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.core.app.NotificationCompat
import com.char2vid.studio.R
import java.util.concurrent.TimeUnit

class JobRestartWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun getForegroundInfo(): ForegroundInfo {
        JobForegroundService.ensureChannel(applicationContext)
        val notification =
            NotificationCompat.Builder(applicationContext, JobForegroundService.CHANNEL_ID)
                .setContentTitle("char2vid")
                .setContentText("Resuming generation…")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(
                WORKER_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            ForegroundInfo(WORKER_NOTIFICATION_ID, notification)
        }
    }

    override suspend fun doWork(): Result {
        setForeground(getForegroundInfo())
        val dao = JobDatabase.getInstance(applicationContext).jobs()
        if (dao.activeCount() > 0) {
            JobForegroundService.start(applicationContext)
        }
        return Result.success()
    }

    companion object {
        private const val UNIQUE = "char2vid-job-restart"
        private const val UNIQUE_PERIODIC = "char2vid-job-restart-periodic"
        private const val WORKER_NOTIFICATION_ID = 43

        fun enqueue(context: Context) {
            val manager = WorkManager.getInstance(context)
            manager.enqueueUniqueWork(
                UNIQUE,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<JobRestartWorker>().build(),
            )
            manager.enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<JobRestartWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
