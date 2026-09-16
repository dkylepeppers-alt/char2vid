package com.char2vid.studio.library

import org.json.JSONArray
import org.json.JSONObject

/**
 * Character/look JSON used by Room rows, the Capacitor bridge, and archive v1
 * records. Field names match `packages/domain/src/characters/schema.ts`.
 */
object CharacterJson {
    private val ROLES = setOf("identity", "body", "look", "pose", "style")
    private val VIEWS = setOf("front", "left", "right", "back", "three-quarter")
    private val APPROVALS = setOf("candidate", "approved")

    /**
     * Web-parity for character-scope archives (`state !== 'pending'`): keep referenced
     * originals that a live library backup would omit; do not silently drop slots.
     */
    fun includeInCharacterPackage(state: String): Boolean = state != "pending"

    fun encodeReferences(references: List<ArchiveCharacterReference>): String {
        val arr = JSONArray()
        for (reference in references) {
            arr.put(encodeReference(reference))
        }
        return arr.toString()
    }

    fun parseReferences(json: String): List<ArchiveCharacterReference> {
        val arr = JSONArray(json)
        val out = ArrayList<ArchiveCharacterReference>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: throw IllegalArgumentException("reference must be an object")
            out.add(parseReference(o, "references[$i]"))
        }
        return out
    }

    fun encodeRevisionIds(ids: List<String>): String {
        val arr = JSONArray()
        for (id in ids) {
            arr.put(id)
        }
        return arr.toString()
    }

    fun parseRevisionIds(json: String): List<String> {
        val arr = JSONArray(json)
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val value = arr.optString(i, "")
            require(value.isNotEmpty()) { "referenceRevisionIds[$i] must be non-empty" }
            out.add(value)
        }
        return out
    }

    fun encodeReference(reference: ArchiveCharacterReference): JSONObject {
        val o = JSONObject()
        o.put("assetRevisionId", reference.assetRevisionId)
        o.put("role", reference.role)
        if (reference.view != null) {
            o.put("view", reference.view)
        }
        o.put("approval", reference.approval)
        return o
    }

    fun parseReference(o: JSONObject, path: String): ArchiveCharacterReference {
        val role = o.getString("role")
        require(role in ROLES) { "$path.role is not a known role" }
        val approval = o.getString("approval")
        require(approval in APPROVALS) { "$path.approval is not a known approval" }
        val view =
            if (!o.has("view") || o.isNull("view")) {
                null
            } else {
                val value = o.getString("view")
                require(value in VIEWS) { "$path.view is not a known view" }
                value
            }
        val assetRevisionId = o.getString("assetRevisionId")
        require(assetRevisionId.isNotEmpty()) { "$path.assetRevisionId must be non-empty" }
        return ArchiveCharacterReference(
            assetRevisionId = assetRevisionId,
            role = role,
            view = view,
            approval = approval,
        )
    }

    fun encodeRevision(revision: ArchiveCharacterRevision): JSONObject {
        val o = JSONObject()
        o.put("id", revision.id)
        o.put("characterId", revision.characterId)
        if (revision.parentRevisionId != null) {
            o.put("parentRevisionId", revision.parentRevisionId)
        }
        o.put("identityNotes", revision.identityNotes)
        val refs = JSONArray()
        for (reference in revision.references) {
            refs.put(encodeReference(reference))
        }
        o.put("references", refs)
        return o
    }

    fun parseRevision(o: JSONObject, path: String): ArchiveCharacterRevision {
        val parent =
            if (!o.has("parentRevisionId") || o.isNull("parentRevisionId")) {
                null
            } else {
                o.getString("parentRevisionId")
            }
        val refsArr = o.optJSONArray("references") ?: throw IllegalArgumentException("$path.references must be an array")
        val refs = ArrayList<ArchiveCharacterReference>(refsArr.length())
        for (i in 0 until refsArr.length()) {
            val ro = refsArr.optJSONObject(i) ?: throw IllegalArgumentException("$path.references[$i] must be an object")
            refs.add(parseReference(ro, "$path.references[$i]"))
        }
        val id = o.getString("id")
        require(id.isNotEmpty()) { "$path.id must be non-empty" }
        val characterId = o.getString("characterId")
        require(characterId.isNotEmpty()) { "$path.characterId must be non-empty" }
        if (parent != null) {
            require(parent.isNotEmpty()) { "$path.parentRevisionId must be non-empty" }
        }
        return ArchiveCharacterRevision(
            id = id,
            characterId = characterId,
            parentRevisionId = parent,
            identityNotes = o.optString("identityNotes", ""),
            references = refs,
        )
    }

    fun encodeCharacter(character: ArchiveCharacter): JSONObject {
        val o = JSONObject()
        o.put("id", character.id)
        o.put("name", character.name)
        o.put("currentRevisionId", character.currentRevisionId)
        if (character.coverAssetRevisionId == null) {
            o.put("coverAssetRevisionId", JSONObject.NULL)
        } else {
            o.put("coverAssetRevisionId", character.coverAssetRevisionId)
        }
        o.put("createdAt", character.createdAt)
        val revisions = JSONArray()
        for (revision in character.revisions) {
            revisions.put(encodeRevision(revision))
        }
        o.put("revisions", revisions)
        return ArchiveJson.stripSecretFields(o)
    }

    fun parseCharacter(o: JSONObject, path: String): ArchiveCharacter {
        val clean = ArchiveJson.stripSecretFields(o)
        val cover =
            if (!clean.has("coverAssetRevisionId") || clean.isNull("coverAssetRevisionId")) {
                null
            } else {
                clean.getString("coverAssetRevisionId")
            }
        val revArr =
            clean.optJSONArray("revisions") ?: throw IllegalArgumentException("$path.revisions must be an array")
        val revisions = ArrayList<ArchiveCharacterRevision>(revArr.length())
        for (i in 0 until revArr.length()) {
            val ro = revArr.optJSONObject(i) ?: throw IllegalArgumentException("$path.revisions[$i] must be an object")
            revisions.add(parseRevision(ro, "$path.revisions[$i]"))
        }
        val id = clean.getString("id")
        require(ArchiveJson.matchesUuid(id)) { "$path.id must be a UUID" }
        val name = clean.getString("name")
        require(name.isNotEmpty()) { "$path.name must be non-empty" }
        val currentRevisionId = clean.getString("currentRevisionId")
        require(ArchiveJson.matchesUuid(currentRevisionId)) { "$path.currentRevisionId must be a UUID" }
        if (cover != null) {
            require(cover.isNotEmpty()) { "$path.coverAssetRevisionId must be non-empty" }
        }
        val createdAt = clean.getString("createdAt")
        require(ArchiveJson.matchesIsoOffsetDateTime(createdAt)) {
            "$path.createdAt must be an ISO-8601 datetime"
        }
        return ArchiveCharacter(
            id = id,
            name = name,
            currentRevisionId = currentRevisionId,
            coverAssetRevisionId = cover,
            createdAt = createdAt,
            revisions = revisions,
        )
    }

    fun encodeLook(look: ArchiveLook): JSONObject {
        val o = JSONObject()
        o.put("id", look.id)
        o.put("characterId", look.characterId)
        o.put("label", look.label)
        o.put("notes", look.notes)
        o.put("referenceRevisionIds", JSONArray(look.referenceRevisionIds))
        return ArchiveJson.stripSecretFields(o)
    }

    fun parseLook(o: JSONObject, path: String): ArchiveLook {
        val clean = ArchiveJson.stripSecretFields(o)
        val idsArr =
            clean.optJSONArray("referenceRevisionIds")
                ?: throw IllegalArgumentException("$path.referenceRevisionIds must be an array")
        val ids = ArrayList<String>(idsArr.length())
        for (i in 0 until idsArr.length()) {
            val value = idsArr.optString(i, "")
            require(value.isNotEmpty()) { "$path.referenceRevisionIds[$i] must be non-empty" }
            ids.add(value)
        }
        val id = clean.getString("id")
        require(id.isNotEmpty()) { "$path.id must be non-empty" }
        val characterId = clean.getString("characterId")
        require(characterId.isNotEmpty()) { "$path.characterId must be non-empty" }
        val label = clean.getString("label")
        require(label.isNotEmpty()) { "$path.label must be non-empty" }
        return ArchiveLook(
            id = id,
            characterId = characterId,
            label = label,
            notes = clean.optString("notes", ""),
            referenceRevisionIds = ids,
        )
    }

    fun characterToBridgeJson(character: CharacterEntity): JSONObject {
        val o = JSONObject()
        o.put("id", character.id)
        o.put("name", character.name)
        o.put("currentRevisionId", character.currentRevisionId)
        if (character.coverAssetRevisionId == null) {
            o.put("coverAssetRevisionId", JSONObject.NULL)
        } else {
            o.put("coverAssetRevisionId", character.coverAssetRevisionId)
        }
        o.put("createdAt", character.createdAt)
        return o
    }

    fun revisionToBridgeJson(revision: CharacterRevisionEntity): JSONObject {
        val parsed = parseRevision(
            JSONObject()
                .put("id", revision.id)
                .put("characterId", revision.characterId)
                .put("parentRevisionId", revision.parentRevisionId ?: JSONObject.NULL)
                .put("identityNotes", revision.identityNotes)
                .put("references", JSONArray(revision.referencesJson)),
            "characterRevision",
        )
        val o = encodeRevision(parsed)
        if (parsed.parentRevisionId == null) {
            o.remove("parentRevisionId")
        }
        return o
    }

    fun lookToBridgeJson(look: LookEntity): JSONObject {
        return encodeLook(
            ArchiveLook(
                id = look.id,
                characterId = look.characterId,
                label = look.label,
                notes = look.notes,
                referenceRevisionIds = parseRevisionIds(look.referenceRevisionIdsJson),
            ),
        )
    }
}
