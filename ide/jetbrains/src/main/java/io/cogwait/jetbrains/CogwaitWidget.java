package io.cogwait.jetbrains;

import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.util.Consumer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Timer;
import java.awt.Component;
import java.awt.event.MouseEvent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// The status-bar widget. Self-contained (no Node dependency): it reads
// ~/.cogwait/config.json, asks the backend for the current ad, renders the
// labeled line, and reports a viewable impression — the same contract as every
// other Cogwait surface. Rendered through the official TextPresentation API.
public class CogwaitWidget implements StatusBarWidget, StatusBarWidget.TextPresentation {
    private String text = "";
    private String url = null;
    private final Timer timer = new Timer(20000, e -> refresh()); // backend rotates fill ~20s

    @Override
    public @NotNull String ID() {
        return "CogwaitWidget";
    }

    @Override
    public void install(@NotNull StatusBar statusBar) {
        refresh();
        timer.start();
    }

    @Override
    public void dispose() {
        timer.stop();
    }

    @Override
    public @Nullable WidgetPresentation getPresentation() {
        return this;
    }

    // ---- TextPresentation ----
    @Override
    public @NotNull String getText() {
        return text;
    }

    @Override
    public float getAlignment() {
        return Component.RIGHT_ALIGNMENT;
    }

    @Override
    public @Nullable String getTooltipText() {
        return url != null ? "Sponsored — " + url + " (click to open)" : "Sponsored placement";
    }

    @Override
    public @Nullable Consumer<MouseEvent> getClickConsumer() {
        return event -> {
            if (url != null) BrowserUtil.browse(url);
        };
    }

    // ---- data ----
    private static String home() {
        return System.getProperty("user.home");
    }

    private static String readConfig() {
        try {
            Path p = Paths.get(home(), ".cogwait", "config.json");
            if (Files.exists(p)) return new String(Files.readAllBytes(p));
        } catch (Exception ignored) {
        }
        return "{}";
    }

    private static String strField(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : "";
    }

    private static int intField(String json, String key, int dflt) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(\\d+)").matcher(json);
        return m.find() ? Integer.parseInt(m.group(1)) : dflt;
    }

    private static boolean truthy(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\"\\s*:\\s*(true|1|\"1\"|\"true\")").matcher(json);
        return m.find();
    }

    private static String label(String adText, String adUrl, int level) {
        String mark = level >= 4 ? "★ " : level >= 3 ? "◆ " : level >= 2 ? "▸ " : "";
        String tail = (adUrl != null && !adUrl.isEmpty()) ? " ›" : "";
        return mark + "[sponsor] " + adText + tail;
    }

    private void refresh() {
        String cfg = readConfig();
        int level = intField(cfg, "level", 1);
        boolean disabled = truthy(cfg, "disabled");
        boolean mock = truthy(cfg, "mock");
        if (disabled || level <= 0) {
            text = "";
            return;
        }
        String api = strField(cfg, "api");
        if (api.isEmpty()) api = "https://api.cogwait.io";
        String payout = strField(cfg, "payout_id");
        String key = strField(cfg, "publisher_key");

        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            String tag = payout.isEmpty() ? "jetbrains" : payout;
            HttpRequest adReq = HttpRequest.newBuilder(URI.create(api + "/ad/next?tag=" + tag))
                    .timeout(Duration.ofSeconds(3)).GET().build();
            HttpResponse<String> adResp = client.send(adReq, HttpResponse.BodyHandlers.ofString());
            String body = adResp.body();
            String adText = strField(body, "text");
            String adUrl = strField(body, "url");
            String adId = strField(body, "id");
            if (adText.isEmpty()) {
                text = "";
                return;
            }
            this.url = adUrl.isEmpty() ? null : adUrl;
            this.text = label(adText, adUrl, level);

            // Report a viewable impression (skip in mock mode or without auth).
            if (!mock && !payout.isEmpty() && !key.isEmpty()) {
                String payload = "{\"publisher_id\":\"" + payout + "\",\"session_tag\":\"jetbrains-"
                        + Math.abs((home() + payout).hashCode()) + "\",\"ad_id\":\"" + adId
                        + "\",\"surface\":\"statusline\",\"level\":" + level + ",\"ts\":" + System.currentTimeMillis() + "}";
                HttpRequest impReq = HttpRequest.newBuilder(URI.create(api + "/impression"))
                        .timeout(Duration.ofSeconds(3))
                        .header("content-type", "application/json")
                        .header("authorization", "Publisher " + payout + ":" + key)
                        .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
                client.sendAsync(impReq, HttpResponse.BodyHandlers.discarding());
            }
        } catch (Exception ignored) {
            // never disrupt the IDE; just leave the last text
        }
    }
}
