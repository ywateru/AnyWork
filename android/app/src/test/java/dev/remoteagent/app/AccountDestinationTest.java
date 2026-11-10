package dev.remoteagent.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URI;
public class AccountDestinationTest {
    @Test public void fixedHttpsEntryHasNoCredentialOrFragment() throws Exception {
        for (boolean signup : new boolean[]{false, true}) {
            URI uri = new URI(AccountDestination.url(signup));
            assertEquals("https", uri.getScheme());
            assertEquals("anywork-tau.vercel.app", uri.getHost());
            assertEquals("/app/", uri.getPath());
            assertNull(uri.getUserInfo()); assertNull(uri.getFragment());
            assertEquals(signup ? "signup=1" : null, uri.getQuery());
        }
    }
}
