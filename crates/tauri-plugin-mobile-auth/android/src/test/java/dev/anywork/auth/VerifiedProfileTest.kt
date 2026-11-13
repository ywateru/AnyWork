package dev.anywork.auth

import io.logto.sdk.android.exception.LogtoException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class VerifiedProfileTest {
    @Test fun unavailableUserInfoRetainsVerifiedClaimsDisplay() {
        val result = verifiedProfile(JSONObject().put("sub", "fixture").put("name", "Verified Name"), null, null)
        assertEquals("Verified Name", result.value.getString("displayName"))
        assertTrue(result.unavailable)
    }

    @Test fun failedProfileRefreshRetainsPriorDisplayOnlyForSameSubject() {
        val prior = JSONObject().put("subject", "fixture").put("displayName", "Prior Verified Name")
        val claims = JSONObject().put("sub", "fixture")
        assertEquals("Prior Verified Name", verifiedProfile(claims, null, prior).value.getString("displayName"))
        prior.put("subject", "other-fixture")
        assertNotEquals("Prior Verified Name", verifiedProfile(claims, null, prior).value.getString("displayName"))
    }

    @Test fun pureGetFailureIsRecoverableButRotationAndIdentityErrorsAreFatal() {
        assertTrue(userInfoGetFailed(LogtoException(LogtoException.Type.UNABLE_TO_FETCH_USER_INFO)))
        for (type in listOf(LogtoException.Type.UNABLE_TO_FETCH_TOKEN_BY_REFRESH_TOKEN, LogtoException.Type.INVALID_ID_TOKEN, LogtoException.Type.NOT_AUTHENTICATED)) {
            assertFalse(userInfoGetFailed(LogtoException(type)))
        }
    }

    @Test(expected = IllegalStateException::class)
    fun mismatchedUserInfoSubjectFailsClosed() {
        verifiedProfile(JSONObject().put("sub", "fixture"), JSONObject().put("sub", "other-fixture"), null)
    }
}
