package com.char2vid.studio;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.char2vid.studio.credentials.CredentialsPlugin;
import com.char2vid.studio.library.ArchivePlugin;
import com.char2vid.studio.library.ExportPlugin;
import com.char2vid.studio.library.LibraryPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LibraryPlugin.class);
        registerPlugin(ExportPlugin.class);
        registerPlugin(ArchivePlugin.class);
        registerPlugin(CredentialsPlugin.class);
        registerPlugin(com.char2vid.studio.jobs.JobsPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
        }
    }
}
