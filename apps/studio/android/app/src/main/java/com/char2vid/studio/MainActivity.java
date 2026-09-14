package com.char2vid.studio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.char2vid.studio.library.ArchivePlugin;
import com.char2vid.studio.library.ExportPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExportPlugin.class);
        registerPlugin(ArchivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
