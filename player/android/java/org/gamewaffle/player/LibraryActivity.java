package org.gamewaffle.player;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class LibraryActivity extends Activity {
    static final String ACTIVE_GAME = "active.waffle";
    private static final int FOLDER_REQUEST = 1, FILE_REQUEST = 2, GAME_REQUEST = 3;
    private static final int BACKGROUND = 0xff14141e, SURFACE = 0xff222233;
    private static final int TEXT = 0xffedf0ff, MUTED = 0xffb3b3cd, ACCENT = 0xffc9acff;
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final ExecutorService artwork = Executors.newFixedThreadPool(2);
    private final LruCache<Uri, Bitmap> covers = new LruCache<Uri, Bitmap>(16 * 1024 * 1024) {
        @Override protected int sizeOf(Uri uri, Bitmap image) { return image.getByteCount(); }
    };
    private List<Game> allGames = new ArrayList<>();
    private final List<Game> visibleGames = new ArrayList<>();
    private SharedPreferences prefs;
    private Uri folder;
    private TextView empty;
    private EditText search;
    private GamesAdapter adapter;
    private boolean scanning, opening;
    private int scanVersion;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("library", MODE_PRIVATE);
        String previous = prefs.getString("folder", null);
        if (previous != null) folder = Uri.parse(previous);
        buildLibrary();
        refresh();
    }

    private void buildLibrary() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left + dp(16), safe.top + dp(12), safe.right + dp(16), safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft() + dp(16), insets.getSystemWindowInsetTop() + dp(12),
                    insets.getSystemWindowInsetRight() + dp(16), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text("My games", 22, TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button choose = new Button(this);
        choose.setText("Choose folder");
        choose.setAllCaps(false);
        choose.setTextColor(ACCENT);
        choose.setBackgroundTintList(ColorStateList.valueOf(SURFACE));
        choose.setOnClickListener(view -> chooseFolder());
        header.addView(choose);
        Button options = new Button(this);
        options.setText("⋮");
        options.setBackgroundTintList(ColorStateList.valueOf(SURFACE));
        options.setContentDescription("Library options");
        options.setMinWidth(dp(44));
        options.setMinimumWidth(dp(44));
        options.setPadding(0, 0, 0, 0);
        options.setOnClickListener(view -> {
            PopupMenu menu = new PopupMenu(this, view);
            menu.getMenu().add("Open cartridge…").setOnMenuItemClickListener(item -> { chooseFile(); return true; });
            menu.getMenu().add("Refresh folder").setEnabled(folder != null && !scanning)
                .setOnMenuItemClickListener(item -> { refresh(); return true; });
            menu.show();
        });
        header.addView(options, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(header);
        search = new EditText(this);
        search.setHint("Search games");
        search.setSingleLine(true);
        search.setTextColor(TEXT);
        search.setHintTextColor(MUTED);
        search.setTextSize(16);
        search.setPadding(dp(14), 0, dp(14), 0);
        search.setBackground(round(SURFACE, 12));
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { filter(); }
            @Override public void afterTextChanged(Editable s) {}
        });
        LinearLayout.LayoutParams searchLayout = new LinearLayout.LayoutParams(-1, dp(46));
        searchLayout.setMargins(0, dp(8), 0, dp(12));
        root.addView(search, searchLayout);
        search.setVisibility(View.GONE);
        root.setFocusableInTouchMode(true);
        root.requestFocus();
        FrameLayout content = new FrameLayout(this);
        empty = text("", 16, MUTED);
        empty.setGravity(Gravity.CENTER);
        content.addView(empty, new FrameLayout.LayoutParams(-1, -1));
        GridView grid = new GridView(this);
        grid.setNumColumns(GridView.AUTO_FIT);
        grid.setColumnWidth(dp(132));
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setHorizontalSpacing(dp(10));
        grid.setVerticalSpacing(dp(10));
        grid.setClipToPadding(false);
        grid.setPadding(0, 0, 0, dp(16));
        grid.setEmptyView(empty);
        adapter = new GamesAdapter();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> open(visibleGames.get(position).uri));
        content.addView(grid, new FrameLayout.LayoutParams(-1, -1));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void chooseFolder() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        if (folder != null && Build.VERSION.SDK_INT >= 26) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, folder);
        startActivityForResult(intent, FOLDER_REQUEST);
    }

    private void chooseFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(intent, FILE_REQUEST);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == GAME_REQUEST) {
            if (result == RESULT_FIRST_USER) message("Could not run this cartridge.");
            return;
        }
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (request == FILE_REQUEST) {
            open(uri);
        } else if (request == FOLDER_REQUEST) {
            try {
                getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (folder != null && !folder.equals(uri)) {
                    try { getContentResolver().releasePersistableUriPermission(folder, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                    catch (SecurityException ignored) {}
                }
                folder = uri;
                prefs.edit().putString("folder", uri.toString()).apply();
                refresh();
            } catch (SecurityException error) {
                message("Could not keep access to this folder.");
            }
        }
    }

    private void refresh() {
        final Uri selected = folder;
        if (selected == null) {
            empty.setText("Choose the folder that contains your cartridges.");
            return;
        }
        int version = ++scanVersion;
        scanning = true;
        covers.evictAll();
        allGames.clear();
        filter();
        storage.execute(() -> {
            try {
                List<Game> games = scan(selected);
                runOnUiThread(() -> {
                    if (version != scanVersion || isDestroyed()) return;
                    allGames = games;
                    scanning = false;
                    filter();
                });
            } catch (RuntimeException error) {
                runOnUiThread(() -> {
                    if (version != scanVersion || isDestroyed()) return;
                    scanning = false;
                    empty.setText("Folder unavailable. Choose it again.");
                });
            }
        });
    }

    private List<Game> scan(Uri tree) {
        List<Game> games = new ArrayList<>();
        ArrayDeque<String> pending = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        pending.add(DocumentsContract.getTreeDocumentId(tree));
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
        };
        while (!pending.isEmpty() && !Thread.currentThread().isInterrupted()) {
            String directory = pending.removeFirst();
            if (!visited.add(directory)) continue;
            Uri list = DocumentsContract.buildChildDocumentsUriUsingTree(tree, directory);
            try (Cursor entries = getContentResolver().query(list, columns, null, null, null)) {
                if (entries == null) throw new IllegalStateException("Folder is unavailable");
                while (entries.moveToNext() && !Thread.currentThread().isInterrupted()) {
                    String id = entries.getString(0), name = entries.getString(1);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(entries.getString(2))) {
                        pending.add(id);
                    } else if (name != null && name.toLowerCase(Locale.ROOT).endsWith(".waffle")
                            && (entries.isNull(3) || entries.getLong(3) <= CartridgeCard.MAX_CARTRIDGE)) {
                        Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                        try (InputStream input = getContentResolver().openInputStream(uri)) {
                            if (input == null) continue;
                            CartridgeCard card = CartridgeCard.read(input, false);
                            String filename = name.substring(0, name.length() - ".waffle".length());
                            games.add(new Game(uri, card.title.trim().isEmpty() ? filename : card.title,
                                card.locale.isEmpty() ? filename : card.locale, card.hasCover));
                        } catch (IOException | SecurityException ignored) {
                            // A removed or unreadable file does not hide the rest of the library.
                        }
                    }
                }
            }
        }
        games.sort(Comparator.comparing((Game game) -> game.title, String.CASE_INSENSITIVE_ORDER)
            .thenComparing(game -> game.detail, String.CASE_INSENSITIVE_ORDER));
        return games;
    }

    private void filter() {
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        visibleGames.clear();
        for (Game game : allGames) {
            if ((game.title + " " + game.detail).toLowerCase(Locale.ROOT).contains(query)) visibleGames.add(game);
        }
        search.setVisibility(allGames.isEmpty() ? View.GONE : View.VISIBLE);
        empty.setText(scanning ? "Scanning cartridges…" : query.isEmpty() ? "No cartridges found in this folder." : "No matching games.");
        adapter.notifyDataSetChanged();
    }

    private void open(Uri uri) {
        if (opening) return;
        opening = true;
        storage.execute(() -> {
            File temporary = null;
            try {
                temporary = File.createTempFile("cartridge-", ".tmp", getCacheDir());
                try (InputStream input = getContentResolver().openInputStream(uri);
                     FileOutputStream output = new FileOutputStream(temporary)) {
                    if (input == null) throw new IOException("Could not read the cartridge");
                    byte[] buffer = new byte[64 * 1024];
                    int count, size = 0;
                    while ((count = input.read(buffer)) != -1) {
                        if ((size += count) > CartridgeCard.MAX_CARTRIDGE) throw new IOException("Cartridge exceeds 256 MiB");
                        if (Thread.currentThread().isInterrupted()) throw new IOException("Opening cancelled");
                        output.write(buffer, 0, count);
                    }
                }
                try (InputStream input = new FileInputStream(temporary)) { CartridgeCard.read(input, false); }
                if (!temporary.renameTo(new File(getCacheDir(), ACTIVE_GAME))) throw new IOException("Could not stage the cartridge");
                runOnUiThread(() -> {
                    opening = false;
                    if (!isFinishing() && !isDestroyed())
                        startActivityForResult(new Intent(this, PlayerActivity.class), GAME_REQUEST);
                });
            } catch (IOException | SecurityException error) {
                runOnUiThread(() -> { opening = false; if (!isDestroyed()) message(error.getMessage()); });
            } finally {
                if (temporary != null) temporary.delete();
            }
        });
    }

    private Bitmap cover(Game game) {
        try (InputStream input = getContentResolver().openInputStream(game.uri)) {
            if (input == null) return null;
            byte[] data = CartridgeCard.read(input, true).cover;
            if (data == null) return null;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, options);
            if (options.outWidth < 1 || options.outHeight < 1 || options.outWidth > 512 || options.outHeight > 512) return null;
            options.inJustDecodeBounds = false;
            options.inSampleSize = Math.max(options.outWidth, options.outHeight) > 384 ? 2 : 1;
            return BitmapFactory.decodeByteArray(data, 0, data.length, options);
        } catch (IOException | SecurityException error) {
            return null;
        }
    }

    @Override protected void onDestroy() {
        storage.shutdownNow();
        artwork.shutdownNow();
        super.onDestroy();
    }

    private void message(String text) {
        Toast.makeText(this, text == null ? "Could not open this cartridge." : text, Toast.LENGTH_LONG).show();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable round(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private static final class Game {
        final Uri uri;
        final String title, detail;
        final boolean art;
        Game(Uri uri, String title, String detail, boolean art) {
            this.uri = uri; this.title = title; this.detail = detail; this.art = art;
        }
    }

    private final class GamesAdapter extends BaseAdapter {
        @Override public int getCount() { return visibleGames.size(); }
        @Override public Game getItem(int position) { return visibleGames.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public View getView(int position, View convertView, ViewGroup parent) {
            Game game = getItem(position);
            Card view = convertView instanceof Card ? (Card) convertView : new Card();
            view.bind(game);
            return view;
        }
    }

    private final class Card extends LinearLayout {
        final ImageView image = new ImageView(LibraryActivity.this);
        final TextView title = text("", 15, TEXT), detail = text("", 12, MUTED);
        volatile Uri bound;
        Card() {
            super(LibraryActivity.this);
            setOrientation(VERTICAL);
            setPadding(dp(8), dp(8), dp(8), dp(9));
            setBackground(round(SURFACE, 14));
            image.setBackground(round(0xff191925, 9));
            image.setClipToOutline(true);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            addView(image, new LinearLayout.LayoutParams(-1, dp(108)));
            title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            title.setSingleLine(true);
            title.setEllipsize(TextUtils.TruncateAt.END);
            title.setPadding(0, dp(6), 0, 0);
            addView(title);
            detail.setSingleLine(true);
            detail.setEllipsize(TextUtils.TruncateAt.END);
            addView(detail);
        }
        void bind(Game game) {
            title.setText(game.title);
            detail.setText(game.detail.equals(game.title) ? "" : game.detail);
            detail.setVisibility(game.detail.equals(game.title) ? View.GONE : View.VISIBLE);
            bound = game.uri;
            int version = scanVersion;
            Bitmap cached = covers.get(game.uri);
            if (cached != null) {
                image.setImageBitmap(cached);
            } else {
                image.setImageResource(getApplicationInfo().icon);
                if (game.art) artwork.execute(() -> {
                    if (!game.uri.equals(bound)) return;
                    Bitmap next = cover(game);
                    if (next == null) return;
                    runOnUiThread(() -> {
                        if (version != scanVersion || isDestroyed()) return;
                        covers.put(game.uri, next);
                        if (game.uri.equals(bound)) image.setImageBitmap(next);
                    });
                });
            }
        }
    }
}
