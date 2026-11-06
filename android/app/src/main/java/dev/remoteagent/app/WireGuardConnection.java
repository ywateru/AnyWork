package dev.remoteagent.app;

import android.content.Context;
import android.content.Intent;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;
import com.wireguard.config.Config;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/** The official userspace WireGuard engine runs inside this app, without a second VPN app. */
final class WireGuardConnection implements Tunnel {
    private static WireGuardConnection instance;
    private final GoBackend backend;
    private volatile State state = State.DOWN;
    private WireGuardConnection(Context context) { backend = new GoBackend(context.getApplicationContext()); }
    static synchronized WireGuardConnection get(Context context) { if (instance == null) instance = new WireGuardConnection(context); return instance; }
    static Intent permission(Context context) { return android.net.VpnService.prepare(context); }
    static Config parse(String text) throws Exception { return Config.parse(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8))); }
    synchronized void connect(String text) throws Exception { backend.setState(this, State.UP, parse(text)); }
    synchronized void disconnect() throws Exception { backend.setState(this, State.DOWN, null); }
    boolean connected() { return state == State.UP; }
    @Override public String getName() { return "AnyWork"; }
    @Override public void onStateChange(State state) { this.state = state; }
}
