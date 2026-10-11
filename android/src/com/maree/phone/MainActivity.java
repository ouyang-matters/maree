package com.maree.phone;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Marée for Android: the phone page (bundled in the app, so it opens and queues photos
 * even without a connection) plus native networking. The computer is found on the local
 * network by a UDP broadcast carrying a hash of the pairing key, so a changed IP address
 * does not matter.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "http://app.maree/";
    static final int DISCOVERY_PORT = 47148;
    static final int REQUEST_FILES = 1;
    static final Pattern KEY = Pattern.compile("[0-9a-f]{16,128}");
    static final Pattern HOST = Pattern.compile("[0-9A-Za-z.\\-]+:[0-9]{2,5}");

    WebView web;
    SharedPreferences prefs;
    ValueCallback<Uri[]> pendingFiles;
    Uri cameraUri;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("maree", MODE_PRIVATE);
        handlePairing(getIntent());

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (!url.startsWith(ORIGIN)) return null;
                String path = req.getUrl().getPath();
                try {
                    if (path == null || path.equals("/") || path.equals("/index.html")) {
                        return new WebResourceResponse("text/html", "utf-8", getAssets().open("index.html"));
                    }
                    if (path.equals("/icon.png")) {
                        return new WebResourceResponse("image/png", null, getAssets().open("icon.png"));
                    }
                } catch (IOException e) {
                    // fall through to 404
                }
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.<String, String>emptyMap(), null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (req.getUrl().toString().startsWith(ORIGIN)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl()));
                } catch (ActivityNotFoundException e) {
                    // nothing to open it with
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                cameraUri = null;
                if (params.isCaptureEnabled() && openCamera()) return true;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.setType("image/*");
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(pick, REQUEST_FILES);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "MareeAndroid");
        setContentView(web);
        web.loadUrl(ORIGIN);
    }

    boolean openCamera() {
        File dir = new File(getCacheDir(), "camera");
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) {
            long cutoff = System.currentTimeMillis() - 2L * 24 * 3600 * 1000;
            for (File f : old) if (f.lastModified() < cutoff) f.delete();
        }
        String name = "IMG_" + System.currentTimeMillis() + ".jpg";
        cameraUri = Uri.parse("content://com.maree.phone.photos/" + name);
        Intent shoot = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        shoot.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        shoot.setClipData(ClipData.newRawUri("", cameraUri));
        shoot.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(shoot, REQUEST_FILES);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            cameraUri = null;
            return false;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQUEST_FILES || pendingFiles == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK) {
            if (cameraUri != null) {
                File f = new File(new File(getCacheDir(), "camera"), cameraUri.getLastPathSegment());
                if (f.length() > 0) uris = new Uri[] { cameraUri };
            } else if (data != null && data.getClipData() != null) {
                ClipData clip = data.getClipData();
                uris = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                uris = new Uri[] { data.getData() };
            }
        }
        pendingFiles.onReceiveValue(uris);
        pendingFiles = null;
        cameraUri = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (handlePairing(intent) && web != null) web.reload();
    }

    /** maree://pair?h=192.168.1.20:47147&k=<key> */
    boolean handlePairing(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        if (d == null || !"maree".equals(d.getScheme()) || !"pair".equals(d.getHost())) return false;
        String k = d.getQueryParameter("k");
        String h = d.getQueryParameter("h");
        if (k == null || !KEY.matcher(k).matches()) return false;
        SharedPreferences.Editor e = prefs.edit().putString("key", k);
        if (h != null && HOST.matcher(h).matches()) e.putString("host", h);
        e.apply();
        Toast.makeText(this, "Marée ✓", Toast.LENGTH_SHORT).show();
        return true;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ------------------------------------------------------------------ networking

    void reply(final int id, final int status, final String body) {
        final String js = "window.__mareeReply && window.__mareeReply(" + id + "," + status + "," + JSONObject.quote(body == null ? "" : body) + ")";
        web.post(new Runnable() {
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    void progress(final int id, final double fraction) {
        final String js = "window.__mareeProgress && window.__mareeProgress(" + id + "," + fraction + ")";
        web.post(new Runnable() {
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    static String sha256Hex(String s) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : h) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Broadcasts on every network; the paired computer answers "MAREE <port>". */
    String discover() {
        String key = prefs.getString("key", null);
        if (key == null) return null;
        byte[] msg = ("MAREE-DISCOVER " + sha256Hex(key).substring(0, 12)).getBytes(StandardCharsets.UTF_8);
        List<InetAddress> targets = new ArrayList<>();
        try {
            String last = prefs.getString("host", null);
            if (last != null) targets.add(InetAddress.getByName(last.substring(0, last.lastIndexOf(':'))));
        } catch (Exception e) {
            // ignore
        }
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress a : ni.getInterfaceAddresses()) {
                    if (a.getBroadcast() != null) targets.add(a.getBroadcast());
                }
            }
            targets.add(InetAddress.getByName("255.255.255.255"));
        } catch (Exception e) {
            // keep what we have
        }
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setBroadcast(true);
            sock.setSoTimeout(500);
            byte[] buf = new byte[64];
            for (int attempt = 0; attempt < 3; attempt++) {
                for (InetAddress t : targets) {
                    try {
                        sock.send(new DatagramPacket(msg, msg.length, t, DISCOVERY_PORT));
                    } catch (IOException e) {
                        // try the next address
                    }
                }
                long until = System.currentTimeMillis() + 700;
                while (System.currentTimeMillis() < until) {
                    try {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        sock.receive(p);
                        String r = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).trim();
                        if (r.startsWith("MAREE ")) {
                            String host = p.getAddress().getHostAddress() + ":" + Integer.parseInt(r.substring(6).trim());
                            prefs.edit().putString("host", host).apply();
                            return host;
                        }
                    } catch (SocketTimeoutException e) {
                        break;
                    } catch (Exception e) {
                        // ignore stray packets
                    }
                }
            }
        } catch (IOException e) {
            // no network
        }
        return null;
    }

    static class Result {
        int status;
        String body;
    }

    Result request(String host, String method, String path, byte[] body, String[][] headers, int id) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL("http://" + host + path).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(body == null ? 5000 : 120000);
        c.setRequestMethod(method);
        c.setRequestProperty("x-maree-key", prefs.getString("key", ""));
        for (String[] h : headers) c.setRequestProperty(h[0], h[1]);
        if (body != null) {
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(body.length);
            c.setRequestProperty("Content-Type", "image/jpeg");
            try (OutputStream out = c.getOutputStream()) {
                int chunk = 64 * 1024;
                double last = 0;
                for (int at = 0; at < body.length; at += chunk) {
                    out.write(body, at, Math.min(chunk, body.length - at));
                    double f = Math.min(1.0, (at + chunk) / (double) body.length);
                    if (f - last >= 0.1 || f >= 1.0) {
                        progress(id, f);
                        last = f;
                    }
                }
            }
        }
        Result r = new Result();
        r.status = c.getResponseCode();
        InputStream in = r.status < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        if (in != null) {
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            in.close();
        }
        r.body = buf.toString("UTF-8");
        c.disconnect();
        return r;
    }

    /** Tries the last known address, and on failure finds the computer again. */
    Result call(String method, String path, byte[] body, String[][] headers, int id) {
        String host = prefs.getString("host", null);
        for (int attempt = 0; attempt < 2; attempt++) {
            if (host != null) {
                try {
                    Result r = request(host, method, path, body, headers, id);
                    hostChanged(host);
                    return r;
                } catch (IOException e) {
                    // fall through to discovery
                }
            }
            if (attempt == 0) {
                String found = discover();
                if (found == null || found.equals(host)) break;
                host = found;
            }
        }
        Result r = new Result();
        r.status = 0;
        r.body = "";
        return r;
    }

    void hostChanged(final String host) {
        final String js = "window.__mareeHost && window.__mareeHost(" + JSONObject.quote(host) + ")";
        web.post(new Runnable() {
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    class Bridge {
        @JavascriptInterface
        public boolean paired() {
            return prefs.getString("key", null) != null;
        }

        @JavascriptInterface
        public String host() {
            return prefs.getString("host", "");
        }

        @JavascriptInterface
        public void unpair() {
            prefs.edit().clear().apply();
        }

        @JavascriptInterface
        public void info(final int id) {
            new Thread(new Runnable() {
                public void run() {
                    Result r = call("GET", "/api/info", null, new String[0][], id);
                    reply(id, r.status, r.body);
                }
            }).start();
        }

        @JavascriptInterface
        public void upload(final int id, final String kind, final String problem, final String name, final String base64) {
            new Thread(new Runnable() {
                public void run() {
                    byte[] bytes;
                    try {
                        bytes = Base64.decode(base64, Base64.DEFAULT);
                    } catch (IllegalArgumentException e) {
                        reply(id, 400, "");
                        return;
                    }
                    String[][] h = {
                        { "x-kind", kind },
                        { "x-problem", problem == null ? "" : problem },
                        { "x-name", Uri.encode(name == null ? "photo.jpg" : name) },
                    };
                    Result r = call("POST", "/api/upload", bytes, h, id);
                    reply(id, r.status, r.body);
                }
            }).start();
        }
    }
}
