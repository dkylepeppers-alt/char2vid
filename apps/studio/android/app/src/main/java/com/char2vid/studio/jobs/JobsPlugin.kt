package com.char2vid.studio.jobs

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "Char2vidJobs")
class JobsPlugin : Plugin() {
    @PluginMethod
    fun enqueue(call: PluginCall) {
        requestNotificationPermission()
        val clientRequestId = call.getString("clientRequestId")
        val operation = call.getString("operation")
        val request = call.getObject("request")
        if (clientRequestId.isNullOrBlank() || operation.isNullOrBlank() || request == null) {
            call.reject("enqueue requires clientRequestId, operation, and request")
            return
        }
        val url = request.optString("url")
        val method = request.optString("method", "POST")
        val body = request.opt("body")
        if (url.isBlank() || body == null) {
            call.reject("request.url and request.body are required")
            return
        }
        try {
            val bodyJson =
                when (body) {
                    is JSONObject, is JSONArray -> body.toString()
                    is String -> body
                    else -> JSONObject.wrap(body)?.toString() ?: "{}"
                }
            val job =
                JobRunner.enqueue(
                    context,
                    clientRequestId,
                    operation,
                    url,
                    method,
                    bodyJson,
                )
            call.resolve(toJs(job))
        } catch (error: Exception) {
            call.reject(error.message ?: "enqueue failed", error)
        }
    }

    @PluginMethod
    fun listJobs(call: PluginCall) {
        try {
            val jobs = JobDatabase.getInstance(context).jobs().listNewest().map { it.toModel() }
            val result = JSObject()
            val array = JSArray()
            for (job in jobs) {
                array.put(toJs(job))
            }
            result.put("jobs", array)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject(error.message ?: "listJobs failed", error)
        }
    }

    @PluginMethod
    fun cancelJob(call: PluginCall) {
        val id = call.getString("jobId")
        if (id.isNullOrBlank()) {
            call.reject("jobId is required")
            return
        }
        try {
            val dao = JobDatabase.getInstance(context).jobs()
            val current = dao.get(id)?.toModel()
            if (current == null) {
                call.reject("job_not_found")
                return
            }
            val cancelled = JobTransitions.cancelQueued(current, System.currentTimeMillis())
            if (cancelled == null) {
                call.reject("cancel_not_allowed")
                return
            }
            dao.update(cancelled.toEntity())
            call.resolve(toJs(cancelled))
        } catch (error: Exception) {
            call.reject(error.message ?: "cancelJob failed", error)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) {
            return
        }
        val host = activity ?: return
        if (ContextCompat.checkSelfPermission(host, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        ActivityCompat.requestPermissions(
            host,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            0,
        )
    }

    private fun toJs(job: DeviceJob): JSObject {
        val json = JSObject()
        json.put("id", job.id)
        json.put("clientRequestId", job.clientRequestId)
        json.put("providerState", job.providerState)
        json.put("saveState", job.saveState)
        if (job.providerRunId != null) {
            json.put("providerRunId", job.providerRunId)
        }
        if (job.errorCode != null) {
            json.put("errorCode", job.errorCode)
        }
        val outputs = JSArray()
        val revisionIds = JSArray()
        if (!job.outputJson.isNullOrBlank()) {
            val parsed = JSONArray(job.outputJson)
            for (i in 0 until parsed.length()) {
                val item = parsed.getJSONObject(i)
                outputs.put(item)
                if (item.has("revisionId")) {
                    revisionIds.put(item.getString("revisionId"))
                }
            }
        }
        json.put("outputRevisionIds", revisionIds)
        json.put("outputs", outputs)
        json.put("updatedAt", java.time.Instant.ofEpochMilli(job.updatedAtMs).toString())
        return json
    }
}
