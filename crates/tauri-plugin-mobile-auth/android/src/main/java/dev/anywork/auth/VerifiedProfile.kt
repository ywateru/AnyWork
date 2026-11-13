package dev.anywork.auth

import android.net.Uri
import io.logto.sdk.android.exception.LogtoException
import org.json.JSONObject

internal data class ProfileResult(val value: JSONObject, val unavailable: Boolean)

/** Only the SDK's UserInfo GET wrapper is recoverable. Errors from its nested
 * token acquisition/rotation are propagated and must fence the grant owner.
 */
internal fun userInfoGetFailed(exception: LogtoException) =
    exception.message == LogtoException.Type.UNABLE_TO_FETCH_USER_INFO.name

internal fun verifiedProfile(claims: JSONObject, info: JSONObject?, previous: JSONObject?): ProfileResult {
    val subject = claims.optString("sub")
    check(subject.isNotBlank() && subject.length <= 128)
    if (info != null) check(info.optString("sub") == subject)
    val prior = previous?.takeIf { it.optString("subject") == subject }
    fun text(key: String): String? = listOfNotNull(info, claims).firstNotNullOfOrNull { data ->
        (data.opt(key) as? String)?.trim()?.takeIf { value ->
            value.isNotEmpty() && value.length <= 160 && value.none { it.isISOControl() }
        }
    }
    val username = text("username") ?: text("preferred_username")
    val email = text("email") ?: if (info == null) prior?.opt("email") as? String else null
    return ProfileResult(JSONObject().apply {
        put("subject", subject)
        put("displayName", text("name") ?: username ?: (if (info == null) prior?.optString("displayName") else null) ?: email ?: "已登录账号")
        put("username", username ?: JSONObject.NULL)
        put("email", email ?: JSONObject.NULL)
        val picture = text("picture")?.takeIf { Uri.parse(it).scheme == "https" }
        put("picture", picture ?: JSONObject.NULL)
    }, info == null)
}
