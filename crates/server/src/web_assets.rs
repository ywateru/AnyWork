//! Bootstrap documents must match the currently installed hashed asset tree.
//! This policy belongs to the static fallback only, never API or source routes.
use axum::{
    Router,
    extract::Request,
    http::{HeaderValue, header},
    middleware::{self, Next},
    response::Response,
};
use std::path::Path;
use tower_http::services::{ServeDir, ServeFile};

pub fn router(directory: &Path) -> Router {
    Router::new()
        .fallback_service(
            ServeDir::new(directory)
                .not_found_service(ServeFile::new(directory.join("index.html"))),
        )
        .layer(middleware::from_fn(bootstrap_cache_policy))
}

async fn bootstrap_cache_policy(mut request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let bootstrap = path == "/"
        || path.ends_with(".html")
        || path.ends_with("/sw.js")
        || request
            .headers()
            .get(header::ACCEPT)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(',')
                    .any(|part| part.trim().starts_with("text/html"))
            });
    if bootstrap {
        // ServeDir's 304 has no Content-Type. Return the current document even
        // when an older installation supplied a Last-Modified validator.
        request.headers_mut().remove(header::IF_MODIFIED_SINCE);
        request.headers_mut().remove(header::IF_NONE_MATCH);
    }
    let mut response = next.run(request).await;
    let html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(';').next() == Some("text/html"));
    if bootstrap || html {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Json, routing::get};
    use reqwest::{Client, StatusCode};
    use serde_json::json;

    struct Server(tokio::task::JoinHandle<()>);
    impl Drop for Server {
        fn drop(&mut self) {
            self.0.abort();
        }
    }

    async fn serve(directory: &Path) -> (String, Server) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route(
                "/api/health",
                get(|| async { Json(json!({"status":"ok"})) }),
            )
            .route_service("/source", ServeFile::new(directory.join("source.tar.gz")))
            .fallback_service(router(directory));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (origin, Server(task))
    }

    #[tokio::test]
    async fn bootstrap_html_and_worker_are_current_and_not_stored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "<html>current</html>").unwrap();
        std::fs::write(dir.path().join("sw.js"), "// current worker").unwrap();
        let (origin, _server) = serve(dir.path()).await;
        let client = Client::builder().no_proxy().build().unwrap();
        let validator = client
            .get(format!("{origin}/"))
            .send()
            .await
            .unwrap()
            .headers()[header::LAST_MODIFIED]
            .clone();
        for path in [
            "/",
            "/?desktop-open=public-nonce",
            "/index.html",
            "/sw.js",
            "/workspace",
        ] {
            // Return the document even when the browser has a matching old
            // validator; do not depend on filesystem timestamp precision.
            let response = client
                .get(format!("{origin}{path}"))
                .header(header::ACCEPT, "text/html,application/xhtml+xml")
                .header(header::IF_MODIFIED_SINCE, validator.clone())
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "no-store",
                "{path}"
            );
            assert_ne!(response.status(), StatusCode::NOT_MODIFIED, "{path}");
            let expected = if path == "/sw.js" {
                "// current worker"
            } else {
                "<html>current</html>"
            };
            assert_eq!(response.text().await.unwrap(), expected);
        }
        // Non-navigation HTML fallbacks (including missing old chunks) cannot
        // become cacheable HTML just because their request lacks Accept.
        let response = client
            .get(format!("{origin}/assets/removed.js"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(response.text().await.unwrap(), "<html>current</html>");
        let response = client.head(format!("{origin}/sw.js")).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert!(response.bytes().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn hashed_assets_api_and_source_keep_their_existing_policy() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("index.html"), "<html>current</html>").unwrap();
        std::fs::write(
            dir.path().join("assets/entry-123.js"),
            "export const version=1;",
        )
        .unwrap();
        std::fs::write(dir.path().join("source.tar.gz"), "source fixture").unwrap();
        let (origin, _server) = serve(dir.path()).await;
        let client = Client::builder().no_proxy().build().unwrap();
        for path in ["/assets/entry-123.js", "/api/health", "/source"] {
            let response = client.get(format!("{origin}{path}")).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert!(
                !response.headers().contains_key(header::CACHE_CONTROL),
                "{path}"
            );
        }
        let validator = client
            .get(format!("{origin}/assets/entry-123.js"))
            .send()
            .await
            .unwrap()
            .headers()[header::LAST_MODIFIED]
            .clone();
        let response = client
            .get(format!("{origin}/assets/entry-123.js"))
            .header(header::IF_MODIFIED_SINCE, validator)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert!(!response.headers().contains_key(header::CACHE_CONTROL));
    }
}
