package org.gamewaffle.player;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Reads the display fields at the front of a cartridge's media section. */
final class CartridgeCard {
    static final int MAX_CARTRIDGE = 256 * 1024 * 1024;
    private static final int MAX_COVER = 2 * 1024 * 1024;
    final String title;
    final String locale;
    final boolean hasCover;
    final byte[] cover;

    private CartridgeCard(String title, String locale, boolean hasCover, byte[] cover) {
        this.title = title;
        this.locale = locale;
        this.hasCover = hasCover;
        this.cover = cover;
    }

    static CartridgeCard read(InputStream stream, boolean loadCover) throws IOException {
        DataInputStream in = new DataInputStream(stream);
        if (in.readInt() != 0x47574146 || in.readUnsignedShort() != 2)
            throw new IOException("This is not a supported GameWaffle cartridge");
        int compressed = Integer.reverseBytes(in.readInt());
        int plain = Integer.reverseBytes(in.readInt());
        if (compressed <= 0 || compressed >= MAX_CARTRIDGE - 110 || plain <= 0 || plain > 32 * 1024 * 1024)
            throw new IOException("Invalid cartridge header");
        skip(in, compressed);
        long entries = length(in, 5);
        String title = "", locale = "";
        boolean hasCover = false;
        byte[] cover = null;
        for (int i = 0; i < Math.min(entries, 4); i++) {
            String key = text(in, 32);
            if ("name".equals(key)) title = text(in, 4096);
            else if ("locale".equals(key)) locale = text(in, 128);
            else if ("coverArt".equals(key)) {
                long size = length(in, 2);
                if (size == 0 || size > MAX_COVER) break;
                hasCover = true;
                if (loadCover) {
                    cover = new byte[(int) size];
                    in.readFully(cover);
                }
                break;
            } else break;
        }
        return new CartridgeCard(title, locale, hasCover, cover);
    }

    private static String text(DataInputStream in, int limit) throws IOException {
        long size = length(in, 3);
        if (size > limit) throw new IOException("Cartridge label is too long");
        byte[] bytes = new byte[(int) size];
        in.readFully(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static long length(DataInputStream in, int type) throws IOException {
        int head = in.readUnsignedByte();
        if ((head >>> 5) != type) throw new IOException("Invalid cartridge display data");
        int size = head & 31;
        if (size < 24) return size;
        if (size == 24) return in.readUnsignedByte();
        if (size == 25) return in.readUnsignedShort();
        if (size == 26) return Integer.toUnsignedLong(in.readInt());
        throw new IOException("Invalid cartridge display length");
    }

    private static void skip(InputStream in, long remaining) throws IOException {
        while (remaining > 0) {
            long count = in.skip(remaining);
            if (count == 0) {
                if (in.read() == -1) throw new EOFException();
                count = 1;
            }
            remaining -= count;
        }
    }
}
