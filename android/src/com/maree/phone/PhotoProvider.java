package com.maree.phone;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.regex.Pattern;

/** Lets the camera app write a photo into this app's cache (content://com.maree.phone.photos/IMG_….jpg). */
public class PhotoProvider extends ContentProvider {
    static final Pattern NAME = Pattern.compile("IMG_[0-9]+\\.jpg");

    static final String UPDATE = "maree-update.apk";

    File file(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (UPDATE.equals(name)) return new File(new File(getContext().getCacheDir(), "updates"), UPDATE);
        if (name == null || !NAME.matcher(name).matches()) throw new FileNotFoundException(String.valueOf(uri));
        File dir = new File(getContext().getCacheDir(), "camera");
        dir.mkdirs();
        return new File(dir, name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = file(uri);
        if (UPDATE.equals(f.getName()) && !mode.equals("r")) throw new FileNotFoundException("read-only");
        if (mode.contains("w") && !f.exists()) {
            try {
                f.createNewFile();
            } catch (IOException e) {
                throw new FileNotFoundException(e.getMessage());
            }
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File f = file(uri);
            MatrixCursor c = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
            c.addRow(new Object[] { f.getName(), f.length() });
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override
    public String getType(Uri uri) {
        if (UPDATE.equals(uri.getLastPathSegment())) return "application/vnd.android.package-archive";
        return "image/jpeg";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
