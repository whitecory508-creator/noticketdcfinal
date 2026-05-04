package com.noticketdc.online;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.Locale;

/**
 * Bridges Web Speech API usage from the WebView to Android {@link TextToSpeech}.
 * System WebView does not reliably play {@code window.speechSynthesis} audio; the
 * hosted app uses {@code SpeechSynthesisUtterance} for voice camera alerts.
 */
public final class SpeechJavaScriptInterface implements TextToSpeech.OnInitListener {

    private static final int INIT_RETRY_MAX = 12;
    private static final long INIT_RETRY_DELAY_MS = 350L;
    private static final long SETTINGS_THROTTLE_MS = 45_000L;

    private final Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private volatile boolean ready;
    private volatile boolean initFinished;
    private volatile boolean initSuccess;
    private long lastTtsSettingsOpenedMs;

    public SpeechJavaScriptInterface(Context context) {
        this.appContext = context.getApplicationContext();
        mainHandler.post(() -> tts = new TextToSpeech(appContext, this));
    }

    @Override
    public void onInit(int status) {
        initFinished = true;
        initSuccess = status == TextToSpeech.SUCCESS;
        ready = initSuccess;
    }

    @JavascriptInterface
    public void speak(String text, String lang, float rate, float pitch, float volume) {
        if (text == null) {
            return;
        }
        String trimmed = text.trim();
        if (trimmed.isEmpty() || volume <= 0.01f) {
            return;
        }
        if (trimmed.length() > 4000) {
            trimmed = trimmed.substring(0, 4000);
        }
        final String toSpeak = trimmed;
        final String safeLang = lang != null ? lang : "en-US";
        trySpeakOnMain(toSpeak, safeLang, rate, pitch, volume, 0);
    }

    private void trySpeakOnMain(String toSpeak, String lang, float rate, float pitch, float volume, int attempt) {
        mainHandler.post(() -> trySpeakInternal(toSpeak, lang, rate, pitch, volume, attempt));
    }

    private void trySpeakInternal(String toSpeak, String lang, float rate, float pitch, float volume, int attempt) {
        if (tts == null) {
            if (initFinished && !initSuccess) {
                openTtsSettingsThrottled();
            }
            return;
        }
        if (ready) {
            int result = speakNow(toSpeak, lang, rate, pitch, volume);
            if (result == TextToSpeech.ERROR) {
                openTtsSettingsThrottled();
            }
            return;
        }
        if (!initFinished && attempt < INIT_RETRY_MAX) {
            mainHandler.postDelayed(
                    () -> trySpeakInternal(toSpeak, lang, rate, pitch, volume, attempt + 1),
                    INIT_RETRY_DELAY_MS);
            return;
        }
        if (!initFinished) {
            openTtsSettingsThrottled();
            return;
        }
        if (!ready) {
            openTtsSettingsThrottled();
        }
    }

    private int speakNow(String toSpeak, String lang, float rate, float pitch, float volume) {
        try {
            tts.stop();
            Locale locale = parseLocale(lang);
            tts.setLanguage(locale != null ? locale : Locale.US);
            tts.setSpeechRate(clamp(rate, 0.5f, 2.0f, 1f));
            tts.setPitch(clamp(pitch, 0.5f, 2.0f, 1f));
            return tts.speak(toSpeak, TextToSpeech.QUEUE_FLUSH, null, "noticketdc");
        } catch (Exception e) {
            openTtsSettingsThrottled();
            return TextToSpeech.ERROR;
        }
    }

    private void openTtsSettingsThrottled() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastTtsSettingsOpenedMs < SETTINGS_THROTTLE_MS) {
            return;
        }
        lastTtsSettingsOpenedMs = now;
        Toast.makeText(
                        appContext,
                        "Text-to-speech is not available. Opening settings—enable TTS and download a voice.",
                        Toast.LENGTH_LONG)
                .show();
        openTtsSettingsBestEffort();
    }

    private void openTtsSettingsBestEffort() {
        int flags = Intent.FLAG_ACTIVITY_NEW_TASK;

        Intent ttsPanel = new Intent("com.android.settings.TTS_SETTINGS");
        ttsPanel.setFlags(flags);
        try {
            appContext.startActivity(ttsPanel);
            return;
        } catch (Exception ignored) {
        }

        Intent checkData = new Intent(TextToSpeech.Engine.ACTION_CHECK_TTS_DATA);
        checkData.setFlags(flags);
        try {
            appContext.startActivity(checkData);
            return;
        } catch (Exception ignored) {
        }

        try {
            Intent googleTts = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            googleTts.setData(Uri.parse("package:com.google.android.tts"));
            googleTts.setFlags(flags);
            appContext.startActivity(googleTts);
            return;
        } catch (Exception ignored) {
        }

        try {
            Intent fallback = new Intent(Settings.ACTION_SETTINGS);
            fallback.setFlags(flags);
            appContext.startActivity(fallback);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void stop() {
        mainHandler.post(() -> {
            if (tts != null) {
                tts.stop();
            }
        });
    }

    public void shutdown() {
        mainHandler.post(() -> {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
            }
            ready = false;
            initFinished = false;
            initSuccess = false;
        });
    }

    private static Locale parseLocale(String lang) {
        if (lang == null || lang.isEmpty()) {
            return Locale.US;
        }
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                return Locale.forLanguageTag(lang.replace('_', '-'));
            }
        } catch (Exception ignored) {
        }
        return Locale.US;
    }

    private static float clamp(float v, float min, float max, float def) {
        if (Float.isNaN(v) || v <= 0f) {
            return def;
        }
        return Math.max(min, Math.min(max, v));
    }
}
