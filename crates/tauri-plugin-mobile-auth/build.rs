fn main() {
    // No guest commands: these methods are called by Rust, never by page JavaScript.
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .build();
}
