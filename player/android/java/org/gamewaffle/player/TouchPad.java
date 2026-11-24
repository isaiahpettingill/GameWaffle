package org.gamewaffle.player;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.util.SparseIntArray;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import org.libsdl.app.SDLActivity;

/** Two independent thumb zones with a shared, multi-pointer button state. */
final class TouchPad extends View {
    private static final int UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, A = 16, B = 32, X = 64, START = 128;
    private static final int[] KEYS = {
        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_Z, KeyEvent.KEYCODE_X, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_ENTER,
    };
    private final SparseIntArray fingers = new SparseIntArray();
    private final SparseIntArray zones = new SparseIntArray();
    private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path shape = new Path();
    private final float density;
    private boolean portrait = true;
    private int held;
    private float padX, padY, arm, faceLeftX, faceRightX, faceOffsetY, radius, startX, startY;

    TouchPad(Context context) {
        super(context);
        setContentDescription("Touch gamepad");
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        density = getResources().getDisplayMetrics().density;
        ink.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        ink.setTextAlign(Paint.Align.CENTER);
    }

    void setPortrait(boolean value) {
        if (portrait != value) release();
        portrait = value;
        position(getWidth(), getHeight());
        invalidate();
    }

    @Override protected void onSizeChanged(int width, int height, int beforeW, int beforeH) {
        position(width, height);
    }

    private void position(int width, int height) {
        arm = Math.min(Math.min(width * .152f, height * (portrait ? .32f : .275f)), density * 70);
        padX = arm + density * 15;
        padY = portrait ? height * .55f : height - arm - density * 15;
        float faceX = width - arm - density * 17;
        faceLeftX = faceX - arm * .44f;
        faceRightX = faceX + arm * .44f;
        faceOffsetY = arm * .49f;
        radius = arm * .33f;
        startX = width * .5f;
        startY = Math.min(height - density * 23, padY + arm * .78f);
    }

    @Override protected void onDraw(Canvas canvas) {
        if (portrait) {
            canvas.drawColor(0xff191925);
            ink.setColor(0xff36364b);
            canvas.drawRect(0, 0, getWidth(), density, ink);
        }
        float neck = arm * .35f;
        shape.reset();
        shape.moveTo(padX-neck,padY-arm);
        shape.lineTo(padX+neck,padY-arm);
        shape.lineTo(padX+neck,padY-neck);
        shape.lineTo(padX+arm,padY-neck);
        shape.lineTo(padX+arm,padY+neck);
        shape.lineTo(padX+neck,padY+neck);
        shape.lineTo(padX+neck,padY+arm);
        shape.lineTo(padX-neck,padY+arm);
        shape.lineTo(padX-neck,padY+neck);
        shape.lineTo(padX-arm,padY+neck);
        shape.lineTo(padX-arm,padY-neck);
        shape.lineTo(padX-neck,padY-neck);
        shape.close();
        ink.setColor(portrait ? 0xff38384e : 0xb82a2a40);
        ink.setPathEffect(new android.graphics.CornerPathEffect(density * 5));
        canvas.drawPath(shape, ink);
        ink.setPathEffect(null);
        direction(canvas, "▲", UP, padX, padY-arm*.66f);
        direction(canvas, "▼", DOWN, padX, padY+arm*.66f);
        direction(canvas, "◀", LEFT, padX-arm*.66f, padY);
        direction(canvas, "▶", RIGHT, padX+arm*.66f, padY);
        face(canvas, "A", A, faceRightX, padY, 0xffc9acff);
        face(canvas, "B", B, faceLeftX, padY+faceOffsetY, 0xff8bdcc9);
        face(canvas, "X", X, faceLeftX, padY-faceOffsetY, 0xfff3c38c);
        ink.setColor((held&START)!=0 ? 0xffc9acff : portrait ? 0xff36364b : 0xbc2d2d40);
        canvas.drawRoundRect(startX-density*28,startY-density*13,startX+density*28,startY+density*13,
            density*13,density*13,ink);
        label(canvas, "Start", startX, startY, density*11, (held&START)!=0 ? 0xff191925 : 0xffedf0ff);
    }

    private void direction(Canvas canvas, String title, int bit, float x, float y) {
        if ((held&bit)!=0) {
            ink.setColor(0xffc9acff);
            canvas.drawCircle(x,y,arm*.23f,ink);
        }
        label(canvas,title,x,y,Math.max(12*density,arm*.26f),(held&bit)!=0 ? 0xff232235 : 0xffedf0ff);
    }

    private void face(Canvas canvas, String title, int bit, float x, float y, int color) {
        ink.setColor((held&bit)!=0 ? color : portrait ? color : (color & 0x00ffffff) | 0xcd000000);
        canvas.drawCircle(x,y,(held&bit)!=0 ? radius*.91f : radius,ink);
        label(canvas,title,x,y,Math.max(14*density,radius*.80f),0xff232235);
    }

    private void label(Canvas canvas, String title, float x, float y, float size, int color) {
        ink.setColor(color);
        ink.setTextSize(size);
        canvas.drawText(title,x,y-(ink.ascent()+ink.descent())*.5f,ink);
    }

    private int zone(float x, float y) {
        if (Math.abs(x-padX) <= arm*1.15f && Math.abs(y-padY) <= arm*1.15f) return 1;
        if (Math.abs(x-startX) <= density*33 && Math.abs(y-startY) <= density*19) return 3;
        return button(x,y)!=0 ? 2 : 0;
    }

    private int button(float x, float y) {
        float near = radius + density*7;
        float a = distance(x,y,faceRightX,padY);
        float b = distance(x,y,faceLeftX,padY+faceOffsetY);
        float xButton = distance(x,y,faceLeftX,padY-faceOffsetY);
        float best = Math.min(a,Math.min(b,xButton));
        return best > near*near ? 0 : a == best ? A : b == best ? B : X;
    }

    private static float distance(float x, float y, float cx, float cy) {
        float dx=x-cx, dy=y-cy;
        return dx*dx+dy*dy;
    }

    static int directions(float x, float y, float deadZone) {
        float ax = Math.abs(x), ay = Math.abs(y);
        if (Math.max(ax,ay) < deadZone) return 0;
        int horizontal = ax >= ay*.44f ? x < 0 ? LEFT : RIGHT : 0;
        int vertical = ay >= ax*.44f ? y < 0 ? UP : DOWN : 0;
        return horizontal|vertical;
    }

    private int value(int lane, float x, float y) {
        if (lane == 1) return directions(x-padX,y-padY,arm*.14f);
        if (lane == 2) return button(x,y);
        return zone(x,y) == 3 ? START : 0;
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        int action=event.getActionMasked(), index=event.getActionIndex(), id=event.getPointerId(index);
        if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
            int lane=zone(event.getX(index),event.getY(index));
            if (lane == 0 && action == MotionEvent.ACTION_DOWN) return false;
            if (lane != 0) zones.put(id,lane);
            getParent().requestDisallowInterceptTouchEvent(true);
        }
        if (action == MotionEvent.ACTION_CANCEL) {
            release();
            return true;
        }
        for (int i=0;i<event.getPointerCount();i++) {
            int finger=event.getPointerId(i), lane=zones.get(finger);
            if (lane != 0) fingers.put(finger,value(lane,event.getX(i),event.getY(i)));
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) {
            zones.delete(id);
            fingers.delete(id);
        }
        int mask=0;
        for (int i=0;i<fingers.size();i++) mask |= fingers.valueAt(i);
        send(mask);
        return true;
    }

    void release() {
        fingers.clear();
        zones.clear();
        send(0);
    }

    private void send(int mask) {
        int changed=held^mask;
        if (changed==0) return;
        for (int i=0;i<KEYS.length;i++) {
            int bit=1<<i;
            if ((changed&bit)==0) continue;
            if ((mask&bit)!=0) SDLActivity.onNativeKeyDown(KEYS[i]);
            else SDLActivity.onNativeKeyUp(KEYS[i]);
        }
        held=mask;
        invalidate();
    }
}
