package dev.remoteagent.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native onboarding, pairing, TLS verification and in-app WireGuard control. */
public final class ConnectionActivity extends Activity {
    private static final int VPN_PERMISSION = 20, IMPORT_CONFIG = 21;
    private static final int BLUE = 0xff007aff, GRAY = 0xff747474;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ConnectionStore store;
    private EditText address, token, pairing;
    private Spinner mode;
    private TextView status, route, vpnStatus;
    private Button connect;
    private String vpnConfig = "";
    private ConnectionProfile pending;
    private boolean busy;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store = new ConnectionStore(this);
        getWindow().setStatusBarColor(Color.WHITE); getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (getIntent().getData() != null || getPreferences(MODE_PRIVATE).getBoolean("welcomed", false)) showConnection(); else showWelcome();
        if (getIntent().getData() != null) importPairing(getIntent().getData().toString());
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout page() {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(Color.WHITE);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        LinearLayout column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setPadding(dp(28), dp(35), dp(28), dp(30));
        scroll.addView(column, new ScrollView.LayoutParams(-1, -1)); setContentView(scroll); return column;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color); v.setLineSpacing(dp(3), 1);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD); return v;
    }
    private void space(LinearLayout layout, int height) { View v = new View(this); layout.addView(v, new LinearLayout.LayoutParams(1, dp(height))); }
    private Button button(String title, View.OnClickListener action, boolean primary) {
        Button b = new Button(this); b.setText(title); b.setAllCaps(false); b.setTextSize(16); b.setTextColor(primary ? Color.WHITE : BLUE);
        GradientDrawable shape = new GradientDrawable(); shape.setColor(primary ? BLUE : 0xffedf5ff); shape.setCornerRadius(dp(14)); b.setBackground(shape);
        b.setPadding(dp(12), dp(8), dp(12), dp(8)); b.setOnClickListener(action); b.setMinHeight(dp(50)); return b;
    }
    private void showWelcome() {
        LinearLayout layout = page(); space(layout, 35);
        TextView title = text("欢迎使用", 38, Color.BLACK, true); title.setGravity(Gravity.CENTER); layout.addView(title);
        TextView brand = text("AnyWork", 43, BLUE, true); brand.setGravity(Gravity.CENTER); layout.addView(brand); space(layout, 40);
        feature(layout, "工作，留在电脑上", "连接桌面正在进行的会话，继续同一项工作。");
        feature(layout, "手机，随时接着完成", "发送消息、查看图片和文件、回应 Agent 的确认请求。");
        feature(layout, "WireGuard + TLS", "使用桌面中继地址，或在 App 内建立私有 WireGuard 隧道，再验证 TLS 连接。");
        space(layout, 30); layout.addView(text("电脑需要保持开机和联网。连接密钥保存在此设备的加密存储中。", 13, GRAY, false)); space(layout, 28);
        layout.addView(button("继续", v -> { getPreferences(MODE_PRIVATE).edit().putBoolean("welcomed", true).apply(); showConnection(); }, true));
    }
    private void feature(LinearLayout layout, String title, String description) {
        layout.addView(text(title, 19, Color.BLACK, true)); space(layout, 7); layout.addView(text(description, 15, GRAY, false)); space(layout, 26);
    }
    private EditText field(LinearLayout layout, String label, String hint, boolean secret) {
        layout.addView(text(label, 14, Color.BLACK, true)); space(layout, 5);
        EditText v = new EditText(this); v.setTextSize(15); v.setHint(hint); v.setSingleLine(true);
        v.setInputType(secret ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        v.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO); v.setSaveEnabled(!secret);
        layout.addView(v, new LinearLayout.LayoutParams(-1, dp(52))); space(layout, 16); return v;
    }
    private void showConnection() {
        LinearLayout layout = page();
        layout.addView(text("连接你的电脑", 30, Color.BLACK, true)); space(layout, 9);
        layout.addView(text("在 AnyWork 桌面应用开启服务，导入配对链接或填写连接信息。", 14, GRAY, false)); space(layout, 24);
        pairing = field(layout, "配对链接", "anywork://connect?…", true);
        layout.addView(button("导入配对链接", v -> importPairing(pairing.getText().toString()), false)); space(layout, 24);
        layout.addView(text("连接方式", 14, Color.BLACK, true));
        mode = new Spinner(this); mode.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"WireGuard + TLS · 桌面中继", "WireGuard + TLS · 私有隧道", "HTTPS · Cloudflare / 其他隧道", "局域网直连"})); layout.addView(mode);
        route = text("", 13, GRAY, false); layout.addView(route); space(layout, 20);
        address = field(layout, "桌面服务地址", "https://work.example.com", false);
        token = field(layout, "访问密钥", "桌面应用中显示的访问密钥", true);
        LinearLayout vpn = new LinearLayout(this); vpn.setOrientation(LinearLayout.VERTICAL);
        vpnStatus = text("尚未导入 WireGuard 配置", 13, GRAY, false); vpn.addView(vpnStatus); space(vpn, 12);
        vpn.addView(button("导入 WireGuard .conf", v -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), IMPORT_CONFIG), false)); space(vpn, 8);
        vpn.addView(button("断开 WireGuard", v -> worker.execute(() -> { try { WireGuardConnection.get(this).disconnect(); runOnUiThread(() -> vpnStatus.setText("WireGuard 已断开")); } catch (Exception e) { showError("无法断开 WireGuard：" + e.getClass().getSimpleName()); } }), false));
        layout.addView(vpn); space(layout, 20);
        mode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(AdapterView<?> p) {}
            public void onItemSelected(AdapterView<?> p, View view, int position, long id) {
                vpn.setVisibility(position == 1 ? View.VISIBLE : View.GONE);
                route.setText(position == 0 ? "App 通过 TLS 访问中继；中继通过 WireGuard 到达电脑。" : position == 1 ? "App 内置 WireGuard 建立私有网络，再通过 TLS 访问桌面。需导入你的 WireGuard 服务端签发的配置。" : position == 2 ? "App 验证桌面地址的 HTTPS 证书后连接。" : "手机与电脑处于同一网络，使用电脑的局域网 IP。");
            }
        });
        status = text("尚未连接", 14, GRAY, false); layout.addView(status); space(layout, 16);
        connect = button("连接并进入会话", v -> beginConnect(), true); layout.addView(connect);
        try {
            ConnectionProfile profile = store.profile();
            if (profile != null) fill(profile);
            vpnConfig = store.get("wireguard"); if (!vpnConfig.isEmpty()) vpnStatus.setText("WireGuard 配置已加密保存");
        } catch (Exception error) { status.setText("无法读取已保存的连接，请重新配对。"); }
    }
    private String transport() { return new String[]{"wireguard-relay", "wireguard-vpn", "https", "lan"}[mode.getSelectedItemPosition()]; }
    private void fill(ConnectionProfile profile) {
        address.setText(profile.server); token.setText(profile.token);
        mode.setSelection("wireguard-relay".equals(profile.transport) ? 0 : "wireguard-vpn".equals(profile.transport) ? 1 : "lan".equals(profile.transport) ? 3 : 2);
    }
    private void importPairing(String value) {
        try { fill(ConnectionProfile.pairing(value)); pairing.setText(""); status.setText("配对信息已导入，点击连接进行验证。"); }
        catch (Exception error) { showError(error.getMessage()); }
    }
    private void beginConnect() {
        if (busy) return;
        try {
            pending = new ConnectionProfile(address.getText().toString(), token.getText().toString(), transport()); pending.validate();
            if ("wireguard-vpn".equals(pending.transport)) {
                if (vpnConfig.isEmpty()) throw new IllegalArgumentException("请先导入 WireGuard 配置");
                WireGuardConnection.parse(vpnConfig);
                Intent permission = WireGuardConnection.permission(this);
                if (permission != null) { startActivityForResult(permission, VPN_PERMISSION); return; }
            }
            connectProfile();
        } catch (Exception error) { showError(error.getMessage()); }
    }
    private void connectProfile() {
        busy = true; connect.setEnabled(false); status.setTextColor(GRAY); status.setText("正在验证连接与访问密钥…");
        final ConnectionProfile profile = pending;
        worker.execute(() -> {
            boolean startedVPN = false;
            try {
                if ("wireguard-vpn".equals(profile.transport)) {
                    WireGuardConnection.get(this).connect(vpnConfig); startedVPN = true;
                    runOnUiThread(() -> { status.setText("WireGuard 已建立，正在验证 TLS…"); vpnStatus.setText("WireGuard 已连接"); });
                }
                JSONObject info = requestInfo(profile);
                store.save(profile);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    status.setText("已连接 " + info.optString("hostname", "桌面服务"));
                    Intent intent = new Intent(this, MainActivity.class); intent.putExtra("native-connection", true); startActivity(intent);
                    busy = false; connect.setEnabled(true);
                });
            } catch (Exception error) {
                if (startedVPN) try { WireGuardConnection.get(this).disconnect(); } catch (Exception ignored) {}
                showError(error instanceof javax.net.ssl.SSLException ? "TLS 证书验证失败。请检查域名与可信证书；不会忽略证书错误。" : error.getMessage() == null ? "连接失败，请检查桌面服务与隧道" : error.getMessage());
                runOnUiThread(() -> { busy = false; if (connect != null) connect.setEnabled(true); });
            }
        });
    }
    private JSONObject requestInfo(ConnectionProfile profile) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(profile.server + "/api/info").openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(10000); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Authorization", "Bearer " + profile.token); connection.setRequestProperty("User-Agent", "AnyWork-Android/" + BuildConfig.VERSION_NAME);
        String id = store.deviceId();
        connection.setRequestProperty("X-AnyWork-Client-Id", id);
        try {
            int code = connection.getResponseCode();
            if (code == 401) throw new IOException("访问密钥无效，请重新配对");
            if (code != 200) throw new IOException("服务返回错误（" + code + "），请检查域名路由");
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) { byte[] buffer = new byte[4096]; int n; while ((n = stream.read(buffer)) != -1) { if (data.size() + n > 65536) throw new IOException("服务响应超出限制"); data.write(buffer, 0, n); } }
            JSONObject json = new JSONObject(data.toString("UTF-8"));
            if (!json.has("hostname") || !json.has("workspace")) throw new IOException("该地址不是兼容的 AnyWork 服务");
            return json;
        } finally { connection.disconnect(); }
    }
    private void showError(String message) { runOnUiThread(() -> { if (!isFinishing() && !isDestroyed() && status != null) { status.setText(message == null ? "无法完成连接" : message); status.setTextColor(0xffb45309); } }); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == VPN_PERMISSION) { if (result == RESULT_OK) connectProfile(); else showError("WireGuard 需要系统 VPN 授权才能建立私有隧道"); }
        if (request == IMPORT_CONFIG && result == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData(); worker.execute(() -> {
                try (InputStream stream = getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new IOException("无法读取配置");
                    ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int n;
                    while ((n = stream.read(buffer)) != -1) { if (output.size() + n > 65536) throw new IOException("WireGuard 配置过大"); output.write(buffer, 0, n); }
                    String config = output.toString("UTF-8"); WireGuardConnection.parse(config); store.put("wireguard", config); vpnConfig = config;
                    runOnUiThread(() -> vpnStatus.setText("WireGuard 配置已导入并加密保存"));
                } catch (Exception error) { showError("WireGuard 配置无效，请检查 .conf 文件"); }
            });
        }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (address == null) showConnection(); if (intent.getData() != null) importPairing(intent.getData().toString()); }
    @Override protected void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
}
