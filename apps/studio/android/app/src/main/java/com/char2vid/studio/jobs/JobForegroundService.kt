package com.char2vid.studio.jobs

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.char2vid.studio.R
import com.char2vid.studio.library.MediaStoreRepository
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class JobForegroundService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val loopStarted = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val notification = buildNotification("Waiting on Nano-GPT…")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        if (loopStarted.compareAndSet(false, true)) {
            executor.execute {
                try {
                    runLoop()
                } finally {
                    loopStarted.set(false)
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun runLoop() {
        val dao = JobDatabase.getInstance(this).jobs()
        val runner =
            JobRunner(
                dao,
                ProviderHttp(),
                ProviderKeyStore(this),
                MediaStoreRepository(this),
                cacheDir,
                nowMs = { System.currentTimeMillis() },
            )
        try {
            var idleTicks = 0
            while (!Thread.currentThread().isInterrupted) {
                val worked = runner.tick()
                if (worked) {
                    idleTicks = 0
                    updateNotification("Generation still running")
                    continue
                }
                idleTicks += 1
                if (idleTicks > 6 && dao.activeCount() == 0) {
                    break
                }
                Thread.sleep(5_000)
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun ensureChannel() {
        JobForegroundService.ensureChannel(this)
    }

    private fun buildNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("char2vid")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    companion object {
        const val CHANNEL_ID = "char2vid.jobs"
        private const val NOTIFICATION_ID = 42

        fun ensureChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            val channel =
                NotificationChannel(
                    CHANNEL_ID,
                    "Generation jobs",
                    NotificationManager.IMPORTANCE_LOW,
                )
            channel.description = "Keeps polling Nano-GPT after you leave Create."
            manager.createNotificationChannel(channel)
        }

        fun start(context: Context) {
            val intent = Intent(context, JobForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
