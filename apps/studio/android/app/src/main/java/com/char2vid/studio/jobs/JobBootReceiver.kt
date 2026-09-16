package com.char2vid.studio.jobs

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class JobBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        JobRestartWorker.enqueue(context)
    }
}
