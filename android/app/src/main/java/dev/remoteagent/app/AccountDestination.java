package dev.remoteagent.app;

/** Fixed public entry only. Incoming intents never choose a server or credentials. */
final class AccountDestination {
    static final String HOME = "https://anywork-tau.vercel.app/app/";
    static String url(boolean signup) { return HOME + (signup ? "?signup=1" : ""); }
    private AccountDestination() {}
}
