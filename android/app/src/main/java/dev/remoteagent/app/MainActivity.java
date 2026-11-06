package dev.remoteagent.app;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.view.View;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** Bundled shared Web client; only the application asset origin has access to the native bridge. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_FILE = 10, SAVE_FILE = 11;
    private WebView web;
    private ValueCallback<Uri[]> upload;
    private String exportContent, sharedText;

    // JavaScript is required by the bundled React UI. External pages open in the system browser.
    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            if (new ConnectionStore(this).profile() == null) { startActivity(new Intent(this, ConnectionActivity.class)); finish(); return; }
        } catch (Exception error) { startActivity(new Intent(this, ConnectionActivity.class)); finish(); return; }
        web = new WebView(this);
        web.setBackgroundColor(0xff15191c);
        setContentView(web);
        web.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " AnyWork-Android/" + BuildConfig.VERSION_NAME);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new ExportBridge(), "RemoteAgentAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"appassets.androidplatform.net".equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                try {
                    InputStream stream = getAssets().open("www" + path);
                    String extension = MimeTypeMap.getFileExtensionFromUrl(path);
                    String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".svg") ? "image/svg+xml" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "utf-8", stream);
                } catch (IOException error) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith(ORIGIN + "/")) return false;
                String scheme = request.getUrl().getScheme();
                if ("https".equals(scheme) || "http".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) { dispatchShare(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (upload != null) upload.onReceiveValue(null);
                upload = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(intent, PICK_FILE); } catch (Exception e) { upload.onReceiveValue(null); upload = null; }
                return true;
            }
        });
        receiveShare(getIntent());
        if (state == null || web.restoreState(state) == null) web.loadUrl(ORIGIN + "/index.html");
    }
    public final class ExportBridge {
        @JavascriptInterface public String getClientId() { return new ConnectionStore(MainActivity.this).deviceId(); }
        @JavascriptInterface public String getConnection() {
            try { return new ConnectionStore(MainActivity.this).webConnection(); } catch (Exception error) { return "null"; }
        }
        @JavascriptInterface public void openConnections() {
            runOnUiThread(() -> { startActivity(new Intent(MainActivity.this, ConnectionActivity.class)); finish(); });
        }
        @JavascriptInterface public void saveFile(String filename, String content) {
            if (content.length() > 32 * 1024 * 1024) return;
            runOnUiThread(() -> {
                if (web.getUrl() == null || !web.getUrl().startsWith(ORIGIN + "/")) return;
                exportContent = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[^a-zA-Z0-9._-]", "_"));
                startActivityForResult(intent, SAVE_FILE);
            });
        }
    }
    private void receiveShare(Intent intent) { if (Intent.ACTION_SEND.equals(intent.getAction())) sharedText = intent.getStringExtra(Intent.EXTRA_TEXT); }
    private void dispatchShare() {
        if (sharedText != null) {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('remote-agent-share',{detail:" + JSONObject.quote(sharedText) + "}))", null);
            sharedText = null;
        }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); receiveShare(intent); dispatchShare(); }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && upload != null) {
            Uri[] files = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) { files = new Uri[data.getClipData().getItemCount()]; for (int i=0;i<files.length;i++) files[i]=data.getClipData().getItemAt(i).getUri(); }
                else if (data.getData() != null) files = new Uri[]{data.getData()};
            }
            upload.onReceiveValue(files); upload = null;
        }
        if (request == SAVE_FILE) {
            if (result == RESULT_OK && data != null && data.getData() != null && exportContent != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) { stream.write(exportContent.getBytes(StandardCharsets.UTF_8)); Toast.makeText(this,"已保存会话",Toast.LENGTH_SHORT).show(); }
                catch (IOException e) { Toast.makeText(this,"保存失败",Toast.LENGTH_SHORT).show(); }
            }
            exportContent = null;
        }
    }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else { startActivity(new Intent(this, ConnectionActivity.class)); finish(); } }
    @Override protected void onDestroy() { if (upload != null) upload.onReceiveValue(null); if (web != null) { web.removeJavascriptInterface("RemoteAgentAndroid"); web.destroy(); } super.onDestroy(); }
}
