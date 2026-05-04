package com.noticketdc.online;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;

public class SplashActivity extends AppCompatActivity {

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		requestWindowFeature(Window.FEATURE_NO_TITLE);
		getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
				WindowManager.LayoutParams.FLAG_FULLSCREEN);
		setContentView(R.layout.ss);

		// Hide system UI (immersive full screen)
		View decorView = getWindow().getDecorView();
		decorView.setSystemUiVisibility(
				View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
						| View.SYSTEM_UI_FLAG_FULLSCREEN
						| View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
						| View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
						| View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
						| View.SYSTEM_UI_FLAG_LAYOUT_STABLE
		);

		// Load GIF using Glide
		ImageView gifImageView = findViewById(R.id.gifImageView);
		Glide.with(this)
				.asGif()
				.load(R.drawable.splash) // your GIF file name (splash.gif)
				.into(gifImageView);

		// Move to MainActivity after 3.4 seconds
		new Handler().postDelayed(() -> {
			Intent mainIntent = new Intent(SplashActivity.this, MainActivity.class);
			startActivity(mainIntent);
			finish();
		}, 6500);
	}
}