fn main() {
    tauri_plugin::Builder::new(&[
        "export_begin",
        "export_write",
        "export_finish",
        "export_abort",
        "open_external",
        "back_set_state",
        "insets_get",
    ])
    .android_path("android")
    .build();
}
