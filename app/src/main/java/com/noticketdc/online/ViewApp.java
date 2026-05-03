package com.noticketdc.online;

import android.app.Application;
import android.content.Context;

public class ViewApp extends Application {

    static Context context;

    @Override
    public void onCreate() {
        super.onCreate();
        context = this;
    }
}