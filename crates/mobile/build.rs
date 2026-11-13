fn main() {
    // Shell owns this list and the invoke handler; add real module commands together.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[])),
    )
    .expect("mobile build metadata");
}
