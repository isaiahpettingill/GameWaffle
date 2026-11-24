package org.gamewaffle.player;

import android.app.AlertDialog;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.RelativeLayout;
import java.io.File;
import org.libsdl.app.SDLActivity;

public final class PlayerActivity extends SDLActivity {
    private View gameSurface;
    private TouchPad pad;
    private Button menu;
    private boolean showPad = true;
    private int slot = 1;
    private AlertDialog pause;

    @Override protected String[] getArguments() {
        return new String[]{new File(getCacheDir(), LibraryActivity.ACTIVE_GAME).getAbsolutePath()};
    }

    @Override protected void main() {
        int result = nativeRunMain(getMainSharedObject(), getMainFunction(), getArguments());
        if (result != 0) runOnUiThread(() -> setResult(RESULT_FIRST_USER));
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (mLayout == null) return;
        if (!new File(getCacheDir(), LibraryActivity.ACTIVE_GAME).isFile()) {
            setResult(RESULT_FIRST_USER);
            finish();
            return;
        }
        gameSurface = mLayout.getChildAt(0);
        gameSurface.setContentDescription("Game display");
        gameSurface.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        mLayout.setBackgroundColor(0xff14141e);
        mLayout.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            }
            return insets;
        });
        showPad = getSharedPreferences("player", MODE_PRIVATE).getBoolean("touch", true);
        pad = new TouchPad(this);
        pad.setId(View.generateViewId());
        menu = new Button(this);
        menu.setId(View.generateViewId());
        menu.setText("☰");
        menu.setTextColor(0xffedf0ff);
        menu.setBackgroundTintList(ColorStateList.valueOf(0xff36364b));
        menu.setContentDescription("Game menu");
        menu.setMinimumWidth(0);
        menu.setMinWidth(0);
        menu.setPadding(0, 0, 0, 0);
        menu.setOnClickListener(view -> openMenu());
        mLayout.addView(pad);
        mLayout.addView(menu);
        mLayout.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right-left != oldRight-oldLeft || bottom-top != oldBottom-oldTop) layoutPad();
        });
        layoutPad();
    }

    private void layoutPad() {
        if (pad == null) return;
        int width = mLayout.getWidth(), height = mLayout.getHeight();
        boolean portrait = width == 0 || height == 0
            ? getResources().getConfiguration().orientation == Configuration.ORIENTATION_PORTRAIT : height >= width;
        pad.setPortrait(portrait);
        pad.setVisibility(showPad ? View.VISIBLE : View.GONE);
        RelativeLayout.LayoutParams controls = new RelativeLayout.LayoutParams(-1,
            portrait ? Math.max(dp(136), Math.min(dp(242), height * 31 / 100)) : -1);
        controls.addRule(RelativeLayout.ALIGN_PARENT_BOTTOM);
        pad.setLayoutParams(controls);
        RelativeLayout.LayoutParams game = new RelativeLayout.LayoutParams(-1, -1);
        if (portrait) game.addRule(RelativeLayout.ABOVE, showPad ? pad.getId() : menu.getId());
        gameSurface.setLayoutParams(game);
        RelativeLayout.LayoutParams menuLayout = new RelativeLayout.LayoutParams(dp(48), dp(44));
        if (portrait) {
            menuLayout.addRule(RelativeLayout.CENTER_HORIZONTAL);
            if (showPad) {
                menuLayout.addRule(RelativeLayout.ALIGN_TOP, pad.getId());
                menuLayout.topMargin = dp(6);
            } else menuLayout.addRule(RelativeLayout.ALIGN_PARENT_BOTTOM);
        } else {
            menuLayout.addRule(RelativeLayout.ALIGN_PARENT_TOP);
            menuLayout.addRule(RelativeLayout.ALIGN_PARENT_END);
        }
        menu.setLayoutParams(menuLayout);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onBackPressed() { openMenu(); }

    private void openMenu() {
        if (pad == null || pause != null || isFinishing()) return;
        pad.release();
        pauseNativeThread();
        final String[] actions = {
            "Save to slot " + slot, "Load slot " + slot, "Change save slot", "Restart game",
            showPad ? "Hide touch controls" : "Show touch controls",
        };
        pause = new AlertDialog.Builder(this).setTitle("Game menu")
            .setNeutralButton("Game library", (dialog, index) -> finish())
            .setPositiveButton("Resume", (dialog, index) -> {})
            .setItems(actions, (dialog, index) -> {
                switch (index) {
                    case 0: press(KeyEvent.KEYCODE_F5); break;
                    case 1: press(KeyEvent.KEYCODE_F9); break;
                    case 2: press(KeyEvent.KEYCODE_F6); slot = slot % 3 + 1; break;
                    case 3: press(KeyEvent.KEYCODE_F2); break;
                    case 4:
                        showPad = !showPad;
                        getSharedPreferences("player", MODE_PRIVATE).edit().putBoolean("touch", showPad).apply();
                        layoutPad();
                        break;
                    default: break;
                }
            }).create();
        pause.setOnDismissListener(dialog -> {
            pause = null;
            if (!isFinishing()) resumeNativeThread();
        });
        pause.show();
        pause.getButton(AlertDialog.BUTTON_NEUTRAL).setAllCaps(false);
        pause.getButton(AlertDialog.BUTTON_POSITIVE).setAllCaps(false);
    }

    private static void press(int key) {
        onNativeKeyDown(key);
        onNativeKeyUp(key);
    }

    @Override protected void onPause() {
        if (pad != null) pad.release();
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        if (!focused && pad != null) pad.release();
        super.onWindowFocusChanged(focused);
    }
}
