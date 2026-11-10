package dev.remoteagent.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Browser-owned HTTPS login and devices. No WebView, bridge, VPN or credential store. */
public final class MainActivity extends Activity {
    private TextView status;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        int padding = (int) (28 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        layout.setBackgroundColor(0xfff7f8fa);
        TextView title = new TextView(this);
        title.setText("AnyWork"); title.setTextSize(30); title.setTextColor(0xff202630);
        layout.addView(title);
        status = new TextView(this);
        status.setText("在安全浏览器中登录同一账号，查看设备并继续工作。登录由浏览器管理，App 不保存密码或连接配置。");
        status.setTextSize(16); status.setTextColor(0xff697482); status.setPadding(0, padding, 0, padding);
        layout.addView(status);
        Button login = new Button(this); login.setText("登录并查看设备"); login.setMinHeight((int)(48 * getResources().getDisplayMetrics().density));
        login.setOnClickListener(view -> open(false)); layout.addView(login);
        Button signup = new Button(this); signup.setText("注册账号"); signup.setOnClickListener(view -> open(true)); layout.addView(signup);
        setContentView(layout);
        // A restored Activity stays on this explicit return screen instead of
        // reopening a browser after rotation/back. No incoming URL is consumed.
        if (state == null) open(false);
    }
    private void open(boolean signup) {
        Uri destination = Uri.parse(AccountDestination.url(signup));
        String provider = CustomTabsClient.getPackageName(this, null);
        if (provider != null) {
            CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tab.intent.setPackage(provider);
            try { tab.launchUrl(this, destination); status.setText("已在浏览器打开账号与设备。返回此页后可重新打开，或注册新账号。"); return; }
            catch (ActivityNotFoundException ignored) { /* Provider changed; use the same fixed HTTPS browser destination. */ }
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, destination).addCategory(Intent.CATEGORY_BROWSABLE));
            status.setText("正在使用系统浏览器登录。设备和工作区将在同一网页中打开。");
        } catch (ActivityNotFoundException error) {
            status.setText("没有可用的浏览器。请安装支持 HTTPS 的浏览器，然后重新打开账号页面。");
        }
    }
}
