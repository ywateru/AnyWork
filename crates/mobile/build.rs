fn main() {
    // Shell owns this list and the invoke handler; add real module commands together.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "mobile_account_snapshot",
            "mobile_account_login",
            "mobile_account_cancel",
            "mobile_account_logout",
            "mobile_account_refresh",
            "mobile_account_device_update",
            "mobile_transport_connect",
            "mobile_transport_http_begin",
            "mobile_transport_http_write",
            "mobile_transport_http_finish",
            "mobile_transport_http_read",
            "mobile_transport_cancel",
            "mobile_transport_close",
            "mobile_transport_pty",
        ]),
    ))
    .expect("mobile build metadata");
}
