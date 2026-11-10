use remote_agent_sdk::{PluginManifest, qualified::*};
use serde_json::json;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

struct Authority {
    allowed: AtomicBool,
    count: AtomicUsize,
}
impl Admission for Authority {
    fn admit(&self, binding: &Binding) -> Result<(), Refused> {
        assert_eq!(*binding, Binding([7; 32]));
        if !self.allowed.load(Ordering::Acquire) {
            return Err(Refused);
        }
        self.count.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }
}
fn authority() -> (Arc<Authority>, Qualification) {
    let a = Arc::new(Authority {
        allowed: AtomicBool::new(true),
        count: AtomicUsize::new(0),
    });
    let q = Qualification::new(Binding([7; 32]), a.clone());
    (a, q)
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(5)
}
fn python() -> String {
    match std::env::var_os("ANYWORK_TEST_PYTHON") {
        Some(value) => {
            let path = PathBuf::from(value);
            assert!(
                path.is_absolute() && path.is_file(),
                "ANYWORK_TEST_PYTHON must identify an existing absolute interpreter path"
            );
            path.into_os_string()
                .into_string()
                .expect("Python path is UTF-8")
        }
        None => if cfg!(windows) { "python" } else { "python3" }.into(),
    }
}
fn fixture() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/qualified_peer.py")
        .to_str()
        .unwrap()
        .into()
}
fn manifest(mode: &str, extra: &[String]) -> PluginManifest {
    // Ignore user-site/PYTHON* startup customization; this peer needs only stdlib.
    let mut args = vec!["-I".into(), "-u".into(), fixture(), mode.into()];
    args.extend_from_slice(extra);
    PluginManifest {
        id: "fake".into(),
        name: "fixture".into(),
        protocol_version: 1,
        command: python(),
        args,
        env: HashMap::new(),
        capabilities: vec![],
    }
}
struct Temporary(PathBuf);
impl Temporary {
    fn new() -> Self {
        Self::new_at(&std::env::temp_dir())
    }
    fn new_at(base: &std::path::Path) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = base.join(format!(
            "aw-q-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
async fn opened() -> (Transport, MetadataReceiver, EventReceiver) {
    opened_mode("stdio", &[]).await
}
async fn opened_mode(mode: &str, extra: &[String]) -> (Transport, MetadataReceiver, EventReceiver) {
    let (t, m, mut e) = Transport::open(Endpoint::Owned(manifest(mode, extra)), Limits::default())
        .await
        .unwrap();
    let ready = match tokio::time::timeout(Duration::from_secs(5), e.recv()).await {
        Ok(Some(ready)) => ready,
        result => {
            let stage = if result.is_err() { "timeout" } else { "closed" };
            assert_eq!(t.close().await, Resource::Reaped);
            panic!("disposable Python peer readiness {stage}; owned child reaped");
        }
    };
    assert_eq!(ready["method"], "ready");
    drop(ready);
    (t, m, e)
}

#[tokio::test]
async fn owned_actual_stdio_refusal_reply_native_error_and_reap() {
    let (t, mut m, _events) = opened().await;
    let (a, q) = authority();
    a.allowed.store(false, Ordering::Release);
    assert_eq!(
        t.call(q.clone(), "echo", json!("refused"), deadline())
            .await
            .unwrap_err(),
        Failure {
            kind: Kind::Refused,
            disposition: Disposition::NotAdmitted
        }
    );
    assert_eq!(a.count.load(Ordering::Acquire), 0);
    a.allowed.store(true, Ordering::Release);
    let reply = t
        .call(q.clone(), "echo", json!({"only":"once"}), deadline())
        .await
        .unwrap();
    assert_eq!(*reply, json!({"only":"once"}));
    assert_eq!(t.incoming_usage().count, 1);
    drop(reply);
    assert_eq!(t.incoming_usage(), Usage::default());
    let error = t
        .call(q, "native-error", json!({}), deadline())
        .await
        .unwrap_err();
    assert_eq!(
        error,
        Failure {
            kind: Kind::NativeError,
            disposition: Disposition::Unknown
        }
    );
    assert!(!error.to_string().contains("private fake"));
    assert_eq!(a.count.load(Ordering::Acquire), 2);
    assert_eq!(t.pending_count(), 0);
    while let Ok(receipt) = m.try_recv() {
        assert!(serde_json::to_vec(&*receipt).unwrap().len() <= 2048);
    }
    assert_eq!(t.metadata_usage(), Usage::default());
    assert_eq!(t.close().await, Resource::Reaped);
    assert_eq!(t.close().await, Resource::Reaped);
    assert_eq!(
        t.call(authority().1, "echo", json!(null), deadline())
            .await
            .unwrap_err()
            .disposition,
        Disposition::NotAdmitted
    );
}

#[tokio::test]
async fn unsupported_bridge_and_bad_limits_have_no_consumer_or_fallback() {
    let error = Transport::open(Endpoint::LegacyBridge, Limits::default())
        .await
        .err()
        .unwrap();
    assert_eq!(error.kind, Kind::UnsupportedBridge);
    assert_eq!(error.disposition, Disposition::NotAdmitted);
    let mut limits = Limits::default();
    limits.metadata.count += 1;
    assert_eq!(
        Transport::open(Endpoint::LegacyBridge, limits)
            .await
            .err()
            .unwrap()
            .kind,
        Kind::InvalidLimits
    );
}

#[tokio::test]
async fn actual_stdio_deadline_cancellation_and_eof_leave_no_pending() {
    let (t, mut metadata, _events) = opened().await;
    let t = Arc::new(t);
    let (a, q) = authority();
    let call = {
        let t = t.clone();
        let q = q.clone();
        tokio::spawn(async move { t.call(q, "hang", json!({}), deadline()).await })
    };
    loop {
        if metadata.recv().await.unwrap().phase == Phase::LocalWrite {
            break;
        }
    }
    call.abort();
    assert!(call.await.unwrap_err().is_cancelled());
    assert_eq!(t.pending_count(), 0);
    let cancelled = metadata.recv().await.unwrap();
    assert_eq!(cancelled.phase, Phase::Cancelled);
    assert_eq!(cancelled.disposition, Disposition::Unknown);
    drop(cancelled);
    let error = t
        .call(
            q.clone(),
            "hang",
            json!({}),
            Instant::now() + Duration::from_millis(100),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        Failure {
            kind: Kind::Deadline,
            disposition: Disposition::Unknown
        }
    );
    assert_eq!(t.pending_count(), 0);
    let mut closed = t.terminal();
    let error = t.call(q, "exit", json!({}), deadline()).await.unwrap_err();
    assert_eq!(error.disposition, Disposition::Unknown);
    if closed.borrow().is_none() {
        closed.changed().await.unwrap();
    }
    assert!(closed.borrow().is_some());
    assert_eq!(a.count.load(Ordering::Acquire), 3);
    assert_eq!(t.close().await, Resource::Reaped);
}

#[tokio::test]
async fn actual_owned_partial_pipe_write_is_unknown_and_reaped() {
    let folder = Temporary::new();
    let count = folder.0.join("count");
    // Establish that the real reader is running before starting the write deadline.
    let (t, _metadata, _events) = opened_mode("partial", &[count.to_str().unwrap().into()]).await;
    let (a, q) = authority();
    let error = t
        .send(
            q,
            json!({"payload":"x".repeat(4 * 1024 * 1024)}),
            deadline(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.disposition, Disposition::Unknown);
    assert_eq!(a.count.load(Ordering::Acquire), 1);
    assert_eq!(t.close().await, Resource::Reaped);
    assert_eq!(std::fs::read_to_string(&count).unwrap(), "4096");
    assert_eq!(t.pending_count(), 0);
    assert_eq!(t.outgoing_usage(), Usage::default());
}

#[tokio::test]
async fn partial_peer_waits_for_exact_prefix_across_short_pipe_reads() {
    let folder = Temporary::new();
    let count = folder.0.join("count");
    let mut child = tokio::process::Command::new(python())
        .args(["-I", "-u", &fixture(), "partial", count.to_str().unwrap()])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    let ready = tokio::time::timeout(Duration::from_secs(5), output.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&ready).unwrap()["method"],
        "ready"
    );
    input.write_all(&[b'x'; 17]).await.unwrap();
    input.flush().await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(child.try_wait().unwrap().is_none());
    assert!(!count.exists());
    input.write_all(&[b'x'; 4096 - 17]).await.unwrap();
    input.flush().await.unwrap();
    // Keep stdin open: the fixture must finish at the prefix, without waiting for EOF.
    assert!(
        tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
    assert_eq!(std::fs::read_to_string(&count).unwrap(), "4096");
}

#[cfg(unix)]
#[tokio::test]
async fn unix_external_process_survives_detach_and_accepts_another_connection() {
    // macOS sockaddr_un is short; /tmp avoids the long per-user TMPDIR.
    let folder = Temporary::new_at(std::path::Path::new("/tmp"));
    let path = folder.0.join("peer.sock");
    let mut child = tokio::process::Command::new(python())
        .args(["-I", "-u", &fixture(), "unix", path.to_str().unwrap()])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut ready = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), ready.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "ready"
    );
    for _ in 0..2 {
        let (t, _metadata, _events) =
            Transport::open(Endpoint::Unix(path.clone()), Limits::default())
                .await
                .unwrap();
        let (_, q) = authority();
        assert_eq!(
            *t.call(q, "echo", json!("external"), deadline())
                .await
                .unwrap(),
            json!("external")
        );
        assert_eq!(t.close().await, Resource::Detached);
        assert!(child.try_wait().unwrap().is_none());
    }
    child.kill().await.unwrap();
    child.wait().await.unwrap();
    std::fs::remove_file(path).unwrap();
}
