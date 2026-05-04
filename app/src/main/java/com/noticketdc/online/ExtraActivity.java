package com.noticketdc.online;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.annotation.SuppressLint;
import android.os.Handler;
import android.view.View;

import androidx.appcompat.app.AppCompatActivity;

@SuppressLint("CustomSplashScreen")
public class ExtraActivity extends AppCompatActivity{

    protected void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (Config.blackStatusBarText) {
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        }

        getWindow().setNavigationBarColor(getResources().getColor(R.color.colorWhite));
        getWindow().setStatusBarColor(getResources().getColor(R.color.colorWhite));

        Intent intent = new Intent(this, MainActivity.class);
        overridePendingTransition(0, 0);
        intent.setFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
        if(getIntent().getExtras() != null) {
            String url = getIntent().getExtras().getString("url");
            if (url != null) {
                if (!url.equals("")) {
                    intent.putExtra("ONESIGNAL_URL", url);
                }
            }
        }
        startActivity(intent);
        this.overridePendingTransition(0, 0);
        Handler handler = new Handler();
        handler.postDelayed(new Runnable() {
            public void run() {
                finish();
            }
        }, 30);
    }
}
