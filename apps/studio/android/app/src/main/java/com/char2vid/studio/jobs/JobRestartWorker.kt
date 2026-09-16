package com.char2vid.studio.jobs

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class JobRestartWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {
    override fun doWork(): Result {
        val dao = JobDatabase.getInstance(applicationContext).jobs()
        if (dao.activeCount() > 0) {
            JobForegroundService.start(applicationContext)
        }
        return Result.success()
    }

    companion object {
        private const val UNIQUE = "char2vid-job-restart"
        private const val UNIQUE_PERIODIC = "char2vid-job-restart-periodic"

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
