package dev.remoteagent.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class ConnectionProfileTest {
    private static final String KEY = "test-key-for-fixtures-only";
    @Test public void importsDesktopWireGuardPairing() {
        ConnectionProfile p = ConnectionProfile.pairing("anywork://connect?server=https%3A%2F%2Fwork.example.com&token=" + KEY + "&transport=wireguard-relay");
        assertEquals("https://work.example.com", p.server); assertEquals("wireguard-relay", p.transport);
    }
    @Test public void privateWireGuardRequiresTLS() {
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("http://10.0.0.1:3210", KEY, "wireguard-vpn").validate());
        new ConnectionProfile("https://desktop.example.com", KEY, "wireguard-vpn").validate();
    }
    @Test public void lanIsExplicit() {
        new ConnectionProfile("http://192.168.1.2:3210/", KEY, "lan").validate();
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("http://192.168.1.2:3210", KEY, "https").validate());
    }
    @Test public void rejectsDuplicateKeysAndUnexpectedOrigins() {
        assertThrows(IllegalArgumentException.class, () -> ConnectionProfile.pairing("anywork://connect?server=https%3A%2F%2Fwork.example.com&token=" + KEY + "&token=another-test-key"));
        assertThrows(IllegalArgumentException.class, () -> ConnectionProfile.pairing("https://example.com?token=" + KEY));
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("https://user:pass@example.com", KEY, "https").validate());
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("https://example.com/other", KEY, "https").validate());
    }
    @Test public void rejectsInvalidKeyAndTransport() {
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("https://example.com", "short", "https").validate());
        assertThrows(IllegalArgumentException.class, () -> new ConnectionProfile("https://example.com", KEY, "command").validate());
    }
}
