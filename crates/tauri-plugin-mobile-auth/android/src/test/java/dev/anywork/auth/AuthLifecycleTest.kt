package dev.anywork.auth

import android.app.Application
import android.content.Intent
import io.logto.sdk.android.auth.logto.LogtoWebViewAuthActivity
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Exercises real public Android callbacks and the actual pinned SDK Activity.
 * No authorization server, code/token exchange or production account is used.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class AuthLifecycleTest {
    @Before fun setup() {
        AuthLifecycle.active = null
        AuthLifecycle.install(RuntimeEnvironment.getApplication())
    }
    @After fun cleanup() { AuthLifecycle.active = null }

    private fun activity() = Robolectric.buildActivity(
        LogtoWebViewAuthActivity::class.java,
        Intent(RuntimeEnvironment.getApplication(), LogtoWebViewAuthActivity::class.java)
            .putExtra("EXTRA_URI", "https://auth.example.invalid/fixture"),
    ).apply { get().setTheme(androidx.appcompat.R.style.Theme_AppCompat) }

    @Test fun restoredActivityWithoutRamAttemptFinishes() {
        val controller = activity().create()
        assertTrue(controller.get().isFinishing)
        controller.destroy()
    }

    @Test fun lateCreationAfterCancelRemainsOwnedByAUntilDestroyed() {
        val a = AuthLifecycle.Attempt(1)
        AuthLifecycle.active = a
        a.cancel() // cancellation during SDK discovery, before Activity creation
        val controller = activity().create()
        assertTrue(controller.get().isFinishing)
        assertFalse(a.destroyed.isCompleted)
        assertEquals(1, a.activities.size)
        controller.destroy()
        assertTrue(a.destroyed.isCompleted)
        assertTrue(a.activities.isEmpty())
        // The operation mutex permits B only after that completed barrier.
        val b = AuthLifecycle.Attempt(2)
        AuthLifecycle.active = b
        assertFalse(b.cancelled)
        assertTrue(b.activities.isEmpty())
    }

    @Test fun cancelDoesNotPretendFinishMeansDestroyed() {
        val a = AuthLifecycle.Attempt(3)
        AuthLifecycle.active = a
        val controller = activity().create()
        assertFalse(a.destroyed.isCompleted)
        a.cancel()
        assertTrue(controller.get().isFinishing)
        assertFalse(a.destroyed.isCompleted)
        controller.destroy()
        assertTrue(a.destroyed.isCompleted)
    }
}
