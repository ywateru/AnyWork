package dev.remoteagent.app;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Pairing input is data, never an instruction or an executable command. */
public final class ConnectionProfile {
    public final String server, token, transport;
    public ConnectionProfile(String server, String token, String transport) {
        this.server = server.trim().replaceAll("/+$", "");
        this.token = token.trim();
        this.transport = transport;
    }
    public void validate() {
        URI uri;
        try { uri = URI.create(server); } catch (Exception error) { throw new IllegalArgumentException("服务地址格式无效"); }
        String scheme = uri.getScheme();
        boolean https = "https".equalsIgnoreCase(scheme);
        if ((!https && !("lan".equals(transport) && "http".equalsIgnoreCase(scheme))) || uri.getHost() == null || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty()))
            throw new IllegalArgumentException("请填写不含路径和凭据的 HTTPS 地址；局域网模式可使用 HTTP");
        if (token.length() < 16 || token.length() > 1024 || token.chars().anyMatch(Character::isWhitespace)) throw new IllegalArgumentException("访问密钥至少需要 16 个字符，不能包含空白");
        if (!("https".equals(transport) || "wireguard-relay".equals(transport) || "wireguard-vpn".equals(transport) || "lan".equals(transport))) throw new IllegalArgumentException("不支持的连接方式");
    }
    private static String decode(String value) {
        try { return URLDecoder.decode(value, "UTF-8"); } catch (java.io.UnsupportedEncodingException error) { throw new IllegalArgumentException("编码无效"); }
    }
    public static ConnectionProfile pairing(String input) {
        URI uri;
        try { uri = URI.create(input.trim()); } catch (Exception error) { throw new IllegalArgumentException("配对链接格式无效"); }
        if (!"anywork".equals(uri.getScheme()) || !"connect".equals(uri.getHost()) || uri.getRawQuery() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new IllegalArgumentException("请导入 AnyWork 桌面应用生成的配对链接");
        Map<String, String> values = new HashMap<>();
        for (String pair : uri.getRawQuery().split("&")) {
            String[] part = pair.split("=", 2);
            String key = decode(part[0]);
            String value = part.length == 2 ? decode(part[1]) : "";
            if (values.put(key, value) != null) throw new IllegalArgumentException("配对链接包含重复字段");
        }
        ConnectionProfile profile = new ConnectionProfile(values.getOrDefault("server", ""), values.getOrDefault("token", ""), values.getOrDefault("transport", "https"));
        profile.validate(); return profile;
    }
}
