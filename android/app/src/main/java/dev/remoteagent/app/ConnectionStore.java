package dev.remoteagent.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Credentials and WireGuard private keys are encrypted with a device-bound Android Keystore key. */
final class ConnectionStore {
    private final SharedPreferences preferences;
    ConnectionStore(Context context) { preferences = context.getSharedPreferences("anywork-connections", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("anywork-connection")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("anywork-connection", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey("anywork-connection", null);
    }
    synchronized void put(String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        if (!preferences.edit().putString(name, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) throw new IllegalStateException("无法保存连接信息");
    }
    synchronized String get(String name) throws Exception {
        String value = preferences.getString(name, null); if (value == null) return "";
        String[] parts = value.split(":", 2); if (parts.length != 2) throw new IllegalStateException("连接信息已损坏，请重新配对");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    synchronized String deviceId() {
        String id = preferences.getString("device-id", null);
        if (id == null) { id = java.util.UUID.randomUUID().toString(); preferences.edit().putString("device-id", id).commit(); }
        return id;
    }
    void save(ConnectionProfile profile) throws Exception {
        profile.validate(); put("profile", new JSONObject().put("url", profile.server).put("token", profile.token).put("transport", profile.transport).toString());
    }
    ConnectionProfile profile() throws Exception {
        String value = get("profile"); if (value.isEmpty()) return null;
        JSONObject json = new JSONObject(value);
        return new ConnectionProfile(json.getString("url"), json.getString("token"), json.getString("transport"));
    }
    String webConnection() throws Exception {
        ConnectionProfile profile = profile(); if (profile == null) return "null";
        return new JSONObject().put("url", profile.server).put("token", profile.token).toString();
    }
}
