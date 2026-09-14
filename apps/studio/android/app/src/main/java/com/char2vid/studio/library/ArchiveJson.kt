package com.char2vid.studio.library

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Explicit allowlist serializer / validating parser for archive v1 JSON.
 *
 * Validation intentionally tracks the zod schemas in `archive-schema.ts` and
 * `asset-schema.ts`: unknown keys are ignored (zod strips them), required keys
 * must be present with the right type, and stub record arrays default to empty.
 * Parse failures throw [IllegalArgumentException] with a path-qualified message.
 */
object ArchiveJson {
    val ALLOWLISTED_ASSET_FIELDS =
        listOf(
            "id",
            "revisionId",
            "kind",
            "name",
            "mime",
            "sha256",
            "bytes",
            "state",
            "createdAt",
            "favorite",
            "rating",
            "folderId",
            "trashedAt",
        )

    private val STUB_RECORD_KEYS = listOf("characters", "looks", "shots", "graphEdges", "timeline")
    private val MEDIA_KINDS = setOf("image", "video", "audio", "embedding")
    private val ASSET_STATES = setOf("pending", "available", "missing")
    private val SCOPES = setOf("library", "project", "character")
    private val SHA256 = Regex("^[a-f0-9]{64}$")

    // zod 4 `z.string().uuid()`: RFC 9562/4122 version + variant nibbles, plus nil/max.
    private val UUID =
        Regex(
            "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" +
                "|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
        )
    private val SECRET_KEY =
        Regex(
            "(credential|password|secret|token|authorization|cookie|api[_-]?key|signed[_-]?url|presigned)",
            RegexOption.IGNORE_CASE,
        )

    // ---- encode --------------------------------------------------------------

    fun encodeManifest(manifest: ArchiveManifest): String {
        val o = JSONObject()
        o.put("schemaVersion", manifest.schemaVersion)
        o.put("createdAt", manifest.createdAt)
        o.put("scope", manifest.scope)
        o.put("scopeId", manifest.scopeId ?: JSONObject.NULL)
        val files = JSONArray()
        for (f in manifest.files) {
            val fo = JSONObject()
            fo.put("path", f.path)
            fo.put("sha256", f.sha256)
            fo.put("bytes", f.bytes)
            fo.put("mime", f.mime)
            files.put(fo)
        }
        o.put("files", files)
        val counts = JSONObject()
        counts.put("assets", manifest.recordCounts.assets)
        counts.put("revisions", manifest.recordCounts.revisions)
        counts.put("collectionMembers", manifest.recordCounts.collectionMembers)
        counts.put("assetTags", manifest.recordCounts.assetTags)
        o.put("recordCounts", counts)
        return o.toString(2) + "\n"
    }

    fun encodeRecords(records: ArchiveRecords): String {
        val o = JSONObject()
        val assets = JSONArray()
        for (a in records.assets) {
            assets.put(encodeAsset(a))
        }
        o.put("assets", assets)
        val revisions = JSONArray()
        for (r in records.revisions) {
            val ro = JSONObject()
            ro.put("id", r.id)
            ro.put("assetId", r.assetId)
            ro.put("sha256", r.sha256)
            ro.put("createdAt", r.createdAt)
            revisions.put(ro)
        }
        o.put("revisions", revisions)
        val members = JSONArray()
        for (m in records.collectionMembers) {
            val mo = JSONObject()
            mo.put("collectionId", m.collectionId)
            mo.put("assetId", m.assetId)
            members.put(mo)
        }
        o.put("collectionMembers", members)
        val tags = JSONArray()
        for (t in records.assetTags) {
            val to = JSONObject()
            to.put("assetId", t.assetId)
            to.put("tag", t.tag)
            tags.put(to)
        }
        o.put("assetTags", tags)
        for (stub in STUB_RECORD_KEYS) {
            o.put(stub, JSONArray())
        }
        return o.toString(2) + "\n"
    }

    /** Only the allowlist leaves the device; any other AssetEntity column is dropped here. */
    private fun encodeAsset(a: ArchiveAsset): JSONObject {
        val o = JSONObject()
        o.put("id", a.id)
        o.put("revisionId", a.revisionId)
        o.put("kind", a.kind)
        o.put("name", a.name)
        o.put("mime", a.mime)
        o.put("sha256", a.sha256)
        o.put("bytes", a.bytes)
        o.put("state", a.state)
        o.put("createdAt", a.createdAt)
        o.put("favorite", a.favorite)
        o.put("rating", a.rating ?: JSONObject.NULL)
        o.put("folderId", a.folderId ?: JSONObject.NULL)
        o.put("trashedAt", a.trashedAt ?: JSONObject.NULL)
        return o
    }

    /** Port of `stripSecretFields` for generic (stub) records. */
    fun stripSecretFields(record: JSONObject): JSONObject {
        val out = JSONObject()
        for (key in record.keys().asSequence().toList()) {
            if (SECRET_KEY.containsMatchIn(key)) {
                continue
            }
            val value = record.get(key)
            out.put(key, stripSecretValue(value))
        }
        return out
    }

    private fun stripSecretValue(value: Any): Any =
        when (value) {
            is JSONObject -> stripSecretFields(value)
            is JSONArray -> {
                val arr = JSONArray()
                for (i in 0 until value.length()) {
                    arr.put(stripSecretValue(value.get(i)))
                }
                arr
            }
            else -> value
        }

    // ---- decode ---------------------------------------------------------------

    /** Returns `schemaVersion` when it is an integer, else null (mirrors the web pre-check). */
    fun peekSchemaVersion(manifestJson: String): Int? {
        val o =
            try {
                JSONObject(manifestJson)
            } catch (_: JSONException) {
                return null
            }
        if (!o.has("schemaVersion") || o.isNull("schemaVersion")) {
            return null
        }
        return exactIntOrNull(o.opt("schemaVersion"))
    }

    fun parseManifest(json: String): ArchiveManifest {
        val o = parseObject(json, "manifest")
        val version = requireInt(o, "schemaVersion", "manifest")
        require(version == ArchivePaths.ARCHIVE_SCHEMA_VERSION) {
            "manifest.schemaVersion must be ${ArchivePaths.ARCHIVE_SCHEMA_VERSION}"
        }
        val createdAt = requireDateTime(o, "createdAt", "manifest")
        val scope = requireString(o, "scope", "manifest")
        require(scope in SCOPES) { "manifest.scope is not a known scope" }
        val scopeId = optionalString(o, "scopeId", "manifest", allowEmpty = false)
        val filesArr = requireArray(o, "files", "manifest")
        val files = ArrayList<ArchiveManifestFile>(filesArr.length())
        for (i in 0 until filesArr.length()) {
            val fo = filesArr.optJSONObject(i) ?: throw IllegalArgumentException("manifest.files[$i] must be an object")
            val p = "manifest.files[$i]"
            files.add(
                ArchiveManifestFile(
                    path = requireString(fo, "path", p),
                    sha256 = requireSha(fo, "sha256", p),
                    bytes = requireNonNegativeLong(fo, "bytes", p),
                    mime = requireString(fo, "mime", p),
                ),
            )
        }
        val counts = o.optJSONObject("recordCounts") ?: throw IllegalArgumentException("manifest.recordCounts required")
        val recordCounts =
            ArchiveRecordCounts(
                assets = requireNonNegativeInt(counts, "assets", "manifest.recordCounts"),
                revisions = requireNonNegativeInt(counts, "revisions", "manifest.recordCounts"),
                collectionMembers = requireNonNegativeInt(counts, "collectionMembers", "manifest.recordCounts"),
                assetTags = requireNonNegativeInt(counts, "assetTags", "manifest.recordCounts"),
            )
        return ArchiveManifest(version, createdAt, scope, scopeId, files, recordCounts)
    }

    fun parseRecords(json: String): ArchiveRecords {
        val o = parseObject(json, "records")
        val assetsArr = requireArray(o, "assets", "records")
        val assets = ArrayList<ArchiveAsset>(assetsArr.length())
        for (i in 0 until assetsArr.length()) {
            val ao = assetsArr.optJSONObject(i) ?: throw IllegalArgumentException("records.assets[$i] must be an object")
            assets.add(parseAsset(ao, "records.assets[$i]"))
        }
        val revisionsArr = requireArray(o, "revisions", "records")
        val revisions = ArrayList<ArchiveRevision>(revisionsArr.length())
        for (i in 0 until revisionsArr.length()) {
            val ro = revisionsArr.optJSONObject(i) ?: throw IllegalArgumentException("records.revisions[$i] must be an object")
            val p = "records.revisions[$i]"
            revisions.add(
                ArchiveRevision(
                    id = requireUuid(ro, "id", p),
                    assetId = requireUuid(ro, "assetId", p),
                    sha256 = requireSha(ro, "sha256", p),
                    createdAt = requireDateTime(ro, "createdAt", p),
                ),
            )
        }
        val membersArr = requireArray(o, "collectionMembers", "records")
        val members = ArrayList<ArchiveCollectionMember>(membersArr.length())
        for (i in 0 until membersArr.length()) {
            val mo = membersArr.optJSONObject(i) ?: throw IllegalArgumentException("records.collectionMembers[$i] must be an object")
            val p = "records.collectionMembers[$i]"
            members.add(
                ArchiveCollectionMember(
                    collectionId = requireString(mo, "collectionId", p),
                    assetId = requireUuid(mo, "assetId", p),
                ),
            )
        }
        val tagsArr = requireArray(o, "assetTags", "records")
        val tags = ArrayList<ArchiveAssetTag>(tagsArr.length())
        for (i in 0 until tagsArr.length()) {
            val to = tagsArr.optJSONObject(i) ?: throw IllegalArgumentException("records.assetTags[$i] must be an object")
            val p = "records.assetTags[$i]"
            tags.add(
                ArchiveAssetTag(
                    assetId = requireUuid(to, "assetId", p),
                    tag = requireString(to, "tag", p),
                ),
            )
        }
        for (stub in STUB_RECORD_KEYS) {
            if (o.has(stub) && !o.isNull(stub)) {
                val arr = o.optJSONArray(stub) ?: throw IllegalArgumentException("records.$stub must be an array")
                for (i in 0 until arr.length()) {
                    if (arr.optJSONObject(i) == null) {
                        throw IllegalArgumentException("records.$stub[$i] must be an object")
                    }
                }
            }
        }
        return ArchiveRecords(assets, revisions, members, tags)
    }

    private fun parseAsset(o: JSONObject, p: String): ArchiveAsset {
        val state = requireString(o, "state", p)
        require(state in ASSET_STATES) { "$p.state is not a known state" }
        val kind = requireString(o, "kind", p)
        require(kind in MEDIA_KINDS) { "$p.kind is not a known media kind" }
        val sha = requireStringAllowEmpty(o, "sha256", p)
        if (state == "pending") {
            require(sha.isEmpty() || SHA256.matches(sha)) { "$p.sha256 must be empty or a sha256 digest" }
        } else {
            require(SHA256.matches(sha)) { "$p.sha256 must be a sha256 digest" }
        }
        val rating: Int? =
            if (!o.has("rating")) {
                throw IllegalArgumentException("$p.rating required")
            } else if (o.isNull("rating")) {
                null
            } else {
                val value = exactIntOrNull(o.opt("rating")) ?: throw IllegalArgumentException("$p.rating must be an integer")
                require(value in 0..5) { "$p.rating must be 0–5" }
                value
            }
        return ArchiveAsset(
            id = requireUuid(o, "id", p),
            revisionId = requireUuid(o, "revisionId", p),
            kind = kind,
            name = requireString(o, "name", p),
            mime = requireString(o, "mime", p),
            sha256 = sha,
            bytes = requireNonNegativeLong(o, "bytes", p),
            state = state,
            createdAt = requireDateTime(o, "createdAt", p),
            favorite = requireBoolean(o, "favorite", p),
            rating = rating,
            folderId = optionalString(o, "folderId", p, allowEmpty = false),
            trashedAt = optionalDateTime(o, "trashedAt", p),
        )
    }

    // ---- primitives -------------------------------------------------------------

    private fun parseObject(json: String, label: String): JSONObject =
        try {
            JSONObject(json)
        } catch (error: JSONException) {
            throw IllegalArgumentException("$label is not a JSON object: ${error.message}", error)
        }

    private fun requireArray(o: JSONObject, key: String, p: String): JSONArray =
        o.optJSONArray(key) ?: throw IllegalArgumentException("$p.$key must be an array")

    private fun requireString(o: JSONObject, key: String, p: String): String {
        val value = requireStringAllowEmpty(o, key, p)
        require(value.isNotEmpty()) { "$p.$key must be non-empty" }
        return value
    }

    private fun requireStringAllowEmpty(o: JSONObject, key: String, p: String): String {
        if (!o.has(key) || o.isNull(key)) {
            throw IllegalArgumentException("$p.$key required")
        }
        val raw = o.opt(key)
        require(raw is String) { "$p.$key must be a string" }
        return raw
    }

    private fun optionalString(o: JSONObject, key: String, p: String, allowEmpty: Boolean): String? {
        if (!o.has(key)) {
            throw IllegalArgumentException("$p.$key required (string or null)")
        }
        if (o.isNull(key)) {
            return null
        }
        val raw = o.opt(key)
        require(raw is String) { "$p.$key must be a string or null" }
        if (!allowEmpty) {
            require(raw.isNotEmpty()) { "$p.$key must be non-empty or null" }
        }
        return raw
    }

    private fun requireBoolean(o: JSONObject, key: String, p: String): Boolean {
        if (!o.has(key) || o.isNull(key)) {
            throw IllegalArgumentException("$p.$key required")
        }
        val raw = o.opt(key)
        require(raw is Boolean) { "$p.$key must be a boolean" }
        return raw
    }

    private fun requireInt(o: JSONObject, key: String, p: String): Int {
        if (!o.has(key) || o.isNull(key)) {
            throw IllegalArgumentException("$p.$key required")
        }
        return exactIntOrNull(o.opt(key)) ?: throw IllegalArgumentException("$p.$key must be an integer")
    }

    private fun requireNonNegativeInt(o: JSONObject, key: String, p: String): Int {
        val value = requireNonNegativeLong(o, key, p)
        require(value <= Int.MAX_VALUE.toLong()) { "$p.$key exceeds Int range" }
        return value.toInt()
    }

    private fun requireNonNegativeLong(o: JSONObject, key: String, p: String): Long {
        if (!o.has(key) || o.isNull(key)) {
            throw IllegalArgumentException("$p.$key required")
        }
        val raw = o.opt(key)
        val asLong = exactLongOrNull(raw) ?: throw IllegalArgumentException("$p.$key must be an integer")
        require(asLong >= 0L) { "$p.$key must be non-negative" }
        return asLong
    }

    private fun exactIntOrNull(raw: Any?): Int? {
        val asLong = exactLongOrNull(raw) ?: return null
        if (asLong < Int.MIN_VALUE.toLong() || asLong > Int.MAX_VALUE.toLong()) {
            return null
        }
        return asLong.toInt()
    }

    private fun exactLongOrNull(raw: Any?): Long? {
        val number = raw as? Number ?: return null
        val asDouble = number.toDouble()
        if (asDouble.isNaN() || asDouble.isInfinite() || asDouble != Math.floor(asDouble)) {
            return null
        }
        if (asDouble > Long.MAX_VALUE.toDouble() || asDouble < Long.MIN_VALUE.toDouble()) {
            return null
        }
        val asLong =
            when (number) {
                is Long -> number
                is Int -> number.toLong()
                else -> asDouble.toLong()
            }
        if (asLong.toDouble() != asDouble) {
            return null
        }
        return asLong
    }

    private fun requireSha(o: JSONObject, key: String, p: String): String {
        val value = requireStringAllowEmpty(o, key, p)
        require(SHA256.matches(value)) { "$p.$key must be a sha256 digest" }
        return value
    }

    private fun requireUuid(o: JSONObject, key: String, p: String): String {
        val value = requireStringAllowEmpty(o, key, p)
        require(UUID.matches(value)) { "$p.$key must be a UUID" }
        return value
    }

    private fun requireDateTime(o: JSONObject, key: String, p: String): String {
        val value = requireStringAllowEmpty(o, key, p)
        require(isIsoDateTime(value)) { "$p.$key must be an ISO-8601 datetime" }
        return value
    }

    private fun optionalDateTime(o: JSONObject, key: String, p: String): String? {
        val value = optionalString(o, key, p, allowEmpty = true) ?: return null
        require(isIsoDateTime(value)) { "$p.$key must be an ISO-8601 datetime or null" }
        return value
    }

    private fun isIsoDateTime(value: String): Boolean =
        try {
            DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse(value)
            true
        } catch (_: DateTimeParseException) {
            false
        }
}
