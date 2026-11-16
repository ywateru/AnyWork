package dev.anywork.auth

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class GrantStoreTest {
    private class Bytes : GrantBytes {
        var value: ByteArray? = null
        var fail = false
        override fun read() = if (fail) throw java.io.IOException() else value
        override fun write(value: ByteArray) { if (fail) throw java.io.IOException(); this.value = value.clone() }
        override fun erase() { value = null }
    }
    private fun grant(n: String = "1") = SavedGrant("fixture-refresh-$n", "fixture-id-$n", "fixture-subject")
    @Test fun currentSchemaOnlyRestoresGrantWithoutAccessToken() {
        val bytes = Bytes(); val a = GrantStore(bytes, "issuer/client/resource/product/scopes")
        assertNull(a.load()); a.save(a.owner(), grant())
        val recovered = GrantStore(bytes, "issuer/client/resource/product/scopes").load()!!
        assertEquals("fixture-refresh-1", recovered.refresh)
        assertFalse(String(bytes.value!!).contains("accessToken"))
        assertFalse(String(bytes.value!!).contains("privateKey"))
    }
    @Test fun pendingSurvivesCrashAndNeverReusesOldRefresh() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding")
        a.save(a.owner(), grant()); a.pending(a.owner(), grant())
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "binding").load() }
    }
    @Test fun verifiedRotationReplacesOldGrantBeforeReady() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding")
        a.save(a.owner(), grant()); a.pending(a.owner(), grant()); a.save(a.owner(), grant("2"))
        assertEquals("fixture-refresh-2", GrantStore(bytes, "binding").load()!!.refresh)
    }
    @Test fun logoutTombstoneRejectsLateSuccessAndLateNoSendRollback() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding"); val owner = a.owner()
        a.save(owner, grant()); a.pending(owner, grant()); a.clear()
        assertThrows(IllegalStateException::class.java) { a.save(owner, grant("2")) }
        assertThrows(IllegalStateException::class.java) { a.pending(owner, grant()) }
        assertNull(GrantStore(bytes, "binding").load())
    }
    @Test fun temporarilyUnavailableReadRetainsRecoverableGrant() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding"); a.save(a.owner(), grant())
        bytes.fail = true
        assertThrows(GrantStorageUnavailable::class.java) { a.load() }
        bytes.fail = false; assertEquals("fixture-refresh-1", a.load()!!.refresh)
    }
    @Test fun logoutWriteFailureUsesCryptographicErasureBoundary() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding"); a.save(a.owner(), grant())
        bytes.fail = true; a.clear(); bytes.fail = false
        assertNull(GrantStore(bytes, "binding").load())
    }
    @Test fun configurationMismatchAndMalformedRecordFailClosed() {
        val bytes = Bytes(); val a = GrantStore(bytes, "binding"); a.save(a.owner(), grant())
        assertThrows(InvalidGrantRecord::class.java) { GrantStore(bytes, "another-product").load() }
        bytes.value = "not-json".toByteArray()
        assertThrows(InvalidGrantRecord::class.java) { a.load() }
    }
    @Test fun realAesGcmRandomizesAndAuthenticatesCiphertextKeyAndBinding() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val raw = "fixture-refresh-secret".toByteArray()
        val encrypted = GrantCipher.seal(key, "issuer/client/resource/product", raw)
        assertFalse(encrypted.contentEquals(GrantCipher.seal(key, "issuer/client/resource/product", raw)))
        assertFalse(String(encrypted).contains("fixture-refresh-secret"))
        assertArrayEquals(raw, GrantCipher.open(key, "issuer/client/resource/product", encrypted))
        assertThrows(InvalidGrantRecord::class.java) { GrantCipher.open(key, "different-resource", encrypted) }
        val changed = encrypted.clone().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertThrows(InvalidGrantRecord::class.java) { GrantCipher.open(key, "issuer/client/resource/product", changed) }
        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertThrows(InvalidGrantRecord::class.java) { GrantCipher.open(other, "issuer/client/resource/product", encrypted) }
    }
    @Test fun keyDeletionFailureStillRemovesRealTemporaryCiphertext() {
        val file = java.io.File.createTempFile("anywork-fixture-ciphertext", ".bin")
        java.io.FileOutputStream(file).use { it.write(byteArrayOf(1, 2, 3)); it.fd.sync() }
        eraseGrant(eraseKey = { throw java.io.IOException("fixture key locked") },
            eraseFile = { check(file.delete()) })
        assertFalse(file.exists())
    }
    @Test fun doubleClearFailureIsExplicitAndOldRecordMustNotBeCalledLoggedOut() {
        val value = grant()
        var ciphertext: ByteArray? = null
        var fail = false
        val backend = object : GrantBytes {
            override fun read() = ciphertext
            override fun write(value: ByteArray) { if (fail) throw java.io.IOException(); ciphertext = value.clone() }
            override fun erase() { if (fail) throw java.io.IOException(); ciphertext = null }
        }
        val store = GrantStore(backend, "binding"); val owner = store.owner(); store.save(owner, value)
        fail = true
        assertThrows(GrantStorageUnavailable::class.java) { store.clear() }
        assertFalse(store.current(owner))
        assertThrows(IllegalStateException::class.java) { store.save(owner, value) }
        // This is why the native layer must explicitly block logout completion.
        assertEquals(value.refresh, GrantStore(backend, "binding").load()!!.refresh)
        fail = false; store.clear()
        assertNull(GrantStore(backend, "binding").load())
    }

    @Test fun storageFailureBeforeRefreshIsTypedAndDoesNotMarkRequestAsSent() {
        val bytes = Bytes(); val store = GrantStore(bytes, "binding"); val saved = grant()
        store.save(store.owner(), saved)
        val txn = RefreshJournal(store, saved.subject) { saved }
        bytes.fail = true
        assertThrows(GrantStorageUnavailable::class.java) { txn.beforeRequest() }
        assertTrue(txn.storageUnavailable); assertFalse(txn.pending)
        bytes.fail = false
        assertEquals(saved.refresh, GrantStore(bytes, "binding").load()!!.refresh)
    }

}
