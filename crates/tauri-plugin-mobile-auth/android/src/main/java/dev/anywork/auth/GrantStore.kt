package dev.anywork.auth

import android.app.Application
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import java.io.FileOutputStream
import android.system.ErrnoException
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class InvalidGrantRecord : Exception()
internal class GrantStorageUnavailable : Exception()

/** No data-class/toString: these values must never enter diagnostics or guest IPC. */
internal class SavedGrant(val refresh: String, val id: String, val subject: String) {
    fun validate() {
        if (refresh.isBlank() || refresh.length > 16384 || id.isBlank() || id.length > 32768 ||
            subject.isBlank() || subject.length > 128 || subject.any { it.isISOControl() }) throw InvalidGrantRecord()
    }
}

internal interface GrantBytes {
    fun read(): ByteArray?
    fun write(value: ByteArray)
    fun erase()
}

/** New schema only. Android auto-backup cannot export either file or Keystore key. */
internal class AndroidGrantBytes(application: Application, private val binding: String) : GrantBytes {
    private val file = File(application.noBackupFilesDir, "anywork-oauth-grant-v1")
    private val temporary = File(file.path + ".new")
    private val alias = "dev.remoteagent.app.oauth-grant.v1"
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) throw InvalidGrantRecord()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    override fun read(): ByteArray? {
        try { Os.stat(file.path) } catch (error: ErrnoException) {
            if (error.errno == OsConstants.ENOENT) return null
            throw error
        }
        val bytes = file.inputStream().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(4096)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                if (output.size() + count > 131072) throw InvalidGrantRecord()
                output.write(chunk, 0, count)
            }
            output.toByteArray()
        }
        return GrantCipher.open(key(false), binding, bytes)
    }
    override fun write(value: ByteArray) {
        val encrypted = GrantCipher.seal(key(true), binding, value)
        FileOutputStream(temporary).use { output ->
            Os.chmod(temporary.path, 384) // 0600, owner only; directory is app private.
            output.write(encrypted)
            output.fd.sync() // AtomicFile.finishWrite merely logs fsync/rename failures.
        }
        Os.rename(temporary.path, file.path)
        syncDirectory()
    }
    private fun syncDirectory() {
        val fd = Os.open(checkNotNull(file.parent), OsConstants.O_RDONLY, 0)
        try { Os.fsync(fd) } finally { Os.close(fd) }
    }
    override fun erase() = eraseGrant(
        eraseKey = { KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }; Unit },
        eraseFile = {
            fun remove(value: File) {
                try { Os.remove(value.path) } catch (error: ErrnoException) {
                    if (error.errno != OsConstants.ENOENT) throw error
                }
            }
            remove(file); remove(temporary); syncDirectory()
        },
    )
}

/** Independent backends: either durable deletion makes the old grant unusable.
 * Never let a locked Keystore prevent attempting ciphertext removal. */
internal fun eraseGrant(eraseKey: () -> Unit, eraseFile: () -> Unit) {
    val keyErased = try { eraseKey(); true } catch (_: Exception) { false }
    val fileErased = try { eraseFile(); true } catch (_: Exception) { false }
    if (!keyErased && !fileErased) throw GrantStorageUnavailable()
}

/** Pure JCE boundary permits real AES-GCM fixtures without user Keystore access. */
internal object GrantCipher {
    private fun aad(binding: String) = ("anywork-native-oauth-grant-v1:" + binding).toByteArray()
    fun seal(key: SecretKey, binding: String, value: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.ENCRYPT_MODE, key); updateAAD(aad(binding))
        check(iv.size == 12)
        byteArrayOf(1) + iv + doFinal(value)
    }
    fun open(key: SecretKey, binding: String, bytes: ByteArray): ByteArray {
        if (bytes.size < 29 || bytes[0] != 1.toByte()) throw InvalidGrantRecord()
        return try {
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                updateAAD(aad(binding)); doFinal(bytes.copyOfRange(13, bytes.size))
            }
        } catch (_: AEADBadTagException) { throw InvalidGrantRecord() }
    }
}

/** The same monitor owns generation + durable journal, including HTTP worker callbacks.
 * A process death with pending never authorizes reuse of the previous refresh token. */
internal class GrantStore(private val bytes: GrantBytes, private val binding: String) {
    private var generation = 0L
    @Synchronized fun owner(): Long = generation
    @Synchronized fun current(owner: Long) = owner == generation
    private fun record(mode: String, grant: SavedGrant?) = JSONObject().apply {
        put("schema", 1); put("binding", binding); put("mode", mode)
        grant?.let { it.validate(); put("refresh", it.refresh); put("id", it.id); put("subject", it.subject) }
    }.toString().toByteArray()
    private fun write(mode: String, grant: SavedGrant?) {
        try { bytes.write(record(mode, grant)) } catch (_: Exception) { throw GrantStorageUnavailable() }
    }
    @Synchronized fun load(): SavedGrant? {
        val raw = try { bytes.read() } catch (error: InvalidGrantRecord) { throw error }
            catch (_: Exception) { throw GrantStorageUnavailable() } ?: return null
        try {
            val value = JSONObject(String(raw, Charsets.UTF_8))
            if (value.getInt("schema") != 1 || value.getString("binding") != binding) throw InvalidGrantRecord()
            return when (value.getString("mode")) {
                "loggedOut" -> null
                "ready" -> SavedGrant(value.getString("refresh"), value.getString("id"), value.getString("subject")).also { it.validate() }
                else -> throw InvalidGrantRecord()
            }
        } catch (_: Exception) { throw InvalidGrantRecord() }
    }
    @Synchronized fun save(owner: Long, grant: SavedGrant) {
        check(current(owner)); write("ready", grant)
    }
    @Synchronized fun pending(owner: Long, grant: SavedGrant) {
        check(current(owner)); write("pending", grant)
    }
    @Synchronized fun clear(): Long {
        generation++ // Even an unavailable disk must never admit a late response.
        try { write("loggedOut", null) }
        catch (_: Exception) {
            try { bytes.erase() } catch (_: Exception) { throw GrantStorageUnavailable() }
        }
        return generation
    }
}
