use super::*;
use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Barrier},
};
struct Fixture {
    dir: PathBuf,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("anywork-ledger-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let path = dir.join("store.sqlite");
        Self { dir, path }
    }
    fn open(&self) -> Store {
        Store::open(&self.path).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
fn sample_session(id: &str) -> Session {
    Session {
        id: id.into(),
        thread_id: Some(format!("native-{id}")),
        title: "fixture".into(),
        cwd: std::env::temp_dir().to_string_lossy().into(),
        agent: "fixture".into(),
        model: None,
        policy: "manual".into(),
        status: "idle".into(),
        archived: false,
        external: false,
        auxiliary: false,
        created_at: 1,
        updated_at: 1,
    }
}
fn seed(store: &Store, id: &str) -> Binding {
    let s = sample_session(id);
    store.save(&s).unwrap();
    Binding {
        agent: s.agent,
        topology: Topology::Owned,
        thread_id: s.thread_id,
        instance_id: None,
        native_version: None,
    }
}
fn intent() -> Intent {
    Intent {
        text: "exact \"Quoted\" 文本\n".into(),
        attachments: vec![],
        composer: None,
        goal: false,
        mode: Mode::Auto,
        queue_if_busy: false,
    }
}
fn fresh() -> (Store, Identity, Binding) {
    let s = Store::open(std::path::Path::new(":memory:")).unwrap();
    let b = seed(&s, "one");
    let p = s.ledger_identity().unwrap();
    (s, p, b)
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn get(s: &Store, p: &Identity, oid: &str) -> Operation {
    match s.lookup_operation(p, "one", oid).unwrap() {
        Lookup::Found(op) => *op,
        other => panic!("unexpected {other:?}"),
    }
}
fn ready(s: &Store, p: &Identity, oid: &str, queued: bool) -> Operation {
    let mut op = get(s, p, oid);
    if !queued {
        op = s
            .select_operation_route(p, "one", oid, op.revision, Route::Start, None)
            .unwrap();
    }
    s.finish_preparation(p, "one", oid, op.revision).unwrap()
}
fn dispatch(s: &Store, p: &Identity, oid: &str, queued: bool) -> DispatchPermit {
    let op = ready(s, p, oid, queued);
    let permit = s
        .begin_operation_dispatch(
            p,
            "one",
            oid,
            op.revision,
            if queued {
                DispatchAuthority::QueueWorker
            } else {
                DispatchAuthority::Immediate
            },
            Route::Start,
            None,
        )
        .unwrap();
    assert_eq!(permit.operation_id(), oid);
    assert_eq!(
        Some(permit.attempt_id()),
        get(s, p, oid).data.dispatch_attempt_id.as_deref()
    );
    permit
}
fn receipt(op: &Operation) -> InputReceipt {
    InputReceipt {
        thread_id: op.data.binding.thread_id.clone().unwrap(),
        client_user_message_id: op.data.client_user_message_id.clone(),
        native_request_id: op.data.native_request_id.clone(),
        native_item_id: format!("item-{}", op.id),
        native_turn_id: Some("turn-exact".into()),
    }
}
fn fails<T: std::fmt::Debug>(result: Result<T>, kind: ErrorKind) {
    assert_eq!(result.unwrap_err().kind, kind);
}
fn at<T>(point: &'static str, f: impl FnOnce() -> T) -> T {
    FAIL_AT.with(|v| *v.borrow_mut() = Some(point));
    let r = f();
    FAIL_AT.with(|v| *v.borrow_mut() = None);
    r
}
fn snapshot(s: &Store) -> String {
    let db = s.0.lock().unwrap();
    let mut result = String::new();
    for table in [
        "message_ledger_identity",
        "message_operation_ids",
        "message_operations",
        "message_operation_preparation",
        "message_operation_queue",
        "message_queue",
        "queue_edits",
        "events",
    ] {
        let mut q = db
            .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2"))
            .unwrap();
        let cols = q.column_count();
        let rows = q
            .query_map([], |r| {
                (0..cols)
                    .map(|i| r.get::<_, rusqlite::types::Value>(i))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap();
        for row in rows {
            result.push_str(&format!("{table}:{:?}\n", row.unwrap()));
        }
    }
    result
}

#[test]
fn canonical_exact_semantics_limits_and_numeric_contract() {
    let mut a = intent();
    a.composer = Some(Composer {
        markdown: "Keep\r\n\"CASE\" é e\u{301}".into(),
        document: serde_json::from_str(r#"{"type":"doc","content":[],"z":{"b":1.0,"a":1}}"#)
            .unwrap(),
    });
    let mut b = a.clone();
    b.composer.as_mut().unwrap().document =
        serde_json::from_str(r#"{"z":{"a":1,"b":1.0},"content":[],"type":"doc"}"#).unwrap();
    assert_eq!(a.canonical().unwrap(), b.canonical().unwrap());
    b.composer.as_mut().unwrap().document["z"]["b"] = json!(1);
    assert_ne!(a.canonical().unwrap(), b.canonical().unwrap());
    b = a.clone();
    b.text = b.text.trim().into();
    assert_ne!(a.canonical().unwrap(), b.canonical().unwrap());
    b = a.clone();
    b.attachments = vec!["a".into(), "b".into()];
    let c = b.canonical().unwrap();
    b.attachments.reverse();
    assert_ne!(c, b.canonical().unwrap());
    b = a.clone();
    b.text = "x".repeat(MAX_CANONICAL);
    fails(b.canonical(), ErrorKind::Invalid);
    let mut doc = json!([]);
    for _ in 0..130 {
        doc = json!([doc]);
    }
    a.composer.as_mut().unwrap().document["content"] = doc;
    fails(a.canonical(), ErrorKind::Invalid);
    let default: Intent = serde_json::from_value(json!({"text":"x"})).unwrap();
    assert_eq!(
        default.canonical().unwrap(),
        Intent {
            text: "x".into(),
            ..intent()
        }
        .canonical()
        .unwrap()
    );
    assert!(serde_json::from_value::<Intent>(json!({"text":"x","mode":"arbitrary"})).is_err());
}
#[test]
fn identity_admission_immutable_conflicts_binding_and_authoritative_absence() {
    let (s, p, b) = fresh();
    let oid = id();
    let a = s.admit_operation(&p, "one", &oid, &intent(), &b).unwrap();
    assert!(a.created);
    assert!(
        !s.admit_operation(&p, "one", &oid, &intent(), &b)
            .unwrap()
            .created
    );
    for body in [
        Intent {
            text: "changed".into(),
            ..intent()
        },
        Intent {
            goal: true,
            ..intent()
        },
        Intent {
            mode: Mode::Steer,
            ..intent()
        },
        Intent {
            queue_if_busy: true,
            ..intent()
        },
        Intent {
            attachments: vec!["source".into()],
            ..intent()
        },
    ] {
        fails(
            s.admit_operation(&p, "one", &oid, &body, &b),
            ErrorKind::IntentConflict,
        );
    }
    let mut wrong = p.clone();
    wrong.ledger_incarnation = id();
    fails(
        s.admit_operation(&wrong, "one", &id(), &intent(), &b),
        ErrorKind::IdentityMismatch,
    );
    assert!(matches!(
        s.lookup_operation(&p, "one", &id()).unwrap(),
        Lookup::NeverRecorded
    ));
    seed(&s, "two");
    fails(
        s.lookup_operation(&p, "two", &oid),
        ErrorKind::BindingConflict,
    );
    let mut changed = s.session("one").unwrap();
    changed.thread_id = Some("different".into());
    s.save(&changed).unwrap();
    assert!(
        !s.admit_operation(&p, "one", &oid, &intent(), &b)
            .unwrap()
            .created
    );
    fails(
        s.select_operation_route(&p, "one", &oid, a.operation.revision, Route::Start, None),
        ErrorKind::BindingConflict,
    );
    fails(
        s.admit_operation(&p, "one", &id(), &intent(), &b),
        ErrorKind::BindingConflict,
    );
}
#[test]
fn same_id_concurrency_returns_one_creation_and_distinct_ids_stay_distinct() {
    let (s, p, b) = fresh();
    let s = Arc::new(s);
    let barrier = Arc::new(Barrier::new(12));
    let oid = id();
    let threads = (0..12)
        .map(|_| {
            let (s, p, b, barrier, oid) = (
                s.clone(),
                p.clone(),
                b.clone(),
                barrier.clone(),
                oid.clone(),
            );
            std::thread::spawn(move || {
                barrier.wait();
                s.admit_operation(&p, "one", &oid, &intent(), &b)
                    .unwrap()
                    .created
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .filter(|created| *created)
            .count(),
        1
    );
    s.admit_operation(&p, "one", &id(), &intent(), &b).unwrap();
    assert_eq!(
        s.list_session_operations(&p, "one", None, 100, false)
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn permanent_used_ids_survive_delete_import_refresh_and_session_recreation() {
    let (s, p, b) = fresh();
    let oid = id();
    s.admit_operation(&p, "one", &oid, &intent(), &b).unwrap();
    s.delete("one").unwrap();
    seed(&s, "one");
    assert!(matches!(
        s.lookup_operation(&p, "one", &oid).unwrap(),
        Lookup::Tombstone
    ));
    fails(
        s.admit_operation(&p, "one", &oid, &intent(), &b),
        ErrorKind::UsedId,
    );
    seed(&s, "two");
    fails(
        s.admit_operation(&p, "two", &oid, &intent(), &b),
        ErrorKind::BindingConflict,
    );
    let mut ext = sample_session("imported");
    ext.agent = "workbuddy".into();
    ext.external = true;
    s.save(&ext).unwrap();
    let binding = Binding {
        agent: ext.agent.clone(),
        topology: Topology::SharedHost,
        thread_id: ext.thread_id.clone(),
        instance_id: None,
        native_version: None,
    };
    let oid2 = id();
    s.admit_operation(&p, &ext.id, &oid2, &intent(), &binding)
        .unwrap();
    s.refresh_imports("workbuddy", &[]).unwrap();
    s.save(&ext).unwrap();
    assert!(matches!(
        s.lookup_operation(&p, &ext.id, &oid2).unwrap(),
        Lookup::Tombstone
    ));
}
#[test]
fn intent_queue_admission_and_dispatch_commit_failures_roll_back_every_row() {
    let (s, p, b) = fresh();
    for stage in [
        "after_registry",
        "after_intent",
        "after_queue_insert",
        "before_commit",
    ] {
        let before = snapshot(&s);
        let oid = id();
        fails(
            at(stage, || {
                s.admit_queued_operation(&p, "one", &oid, &intent(), &b)
            }),
            ErrorKind::Storage,
        );
        assert_eq!(before, snapshot(&s));
        assert!(matches!(
            s.lookup_operation(&p, "one", &oid).unwrap(),
            Lookup::NeverRecorded
        ));
    }
    let oid = id();
    s.admit_queued_operation(&p, "one", &oid, &intent(), &b)
        .unwrap();
    let op = ready(&s, &p, &oid, true);
    let before = snapshot(&s);
    for stage in [
        "after_dispatch_state",
        "before_commit_dispatch",
        "before_commit",
    ] {
        fails(
            at(stage, || {
                s.begin_operation_dispatch(
                    &p,
                    "one",
                    &oid,
                    op.revision,
                    DispatchAuthority::QueueWorker,
                    Route::Start,
                    None,
                )
            }),
            ErrorKind::Storage,
        );
        assert_eq!(before, snapshot(&s));
    }
}
#[test]
fn preparation_claim_receipt_manifest_budgets_and_no_second_qualification() {
    let (s, p, b) = fresh();
    let oid = id();
    let body = Intent {
        attachments: vec!["original-mutable-path".into()],
        ..intent()
    };
    let op = s
        .admit_operation(&p, "one", &oid, &body, &b)
        .unwrap()
        .operation;
    let spec = PreparationSpec::Snapshot { index: 0 };
    let claim = match s
        .claim_preparation_step(&p, "one", &oid, op.revision, &spec)
        .unwrap()
    {
        PreparationClaim::New(p) => p,
        _ => panic!(),
    };
    assert!(matches!(
        s.claim_preparation_step(&p, "one", &oid, op.revision, &spec)
            .unwrap(),
        PreparationClaim::Existing {
            phase: StepPhase::Claimed,
            ..
        }
    ));
    assert_eq!(claim.operation_id(), oid);
    let before = snapshot(&s);
    let mut a = Artifact {
        index: 0,
        relative_path: format!("{oid}/snapshot"),
        size: 3,
        sha256: hash(b"abc"),
    };
    a.relative_path = format!("{oid}/../escape");
    fails(
        s.confirm_preparation_step(
            &p,
            "one",
            &claim,
            &PreparationReceipt::Snapshot {
                artifact: a.clone(),
            },
        ),
        ErrorKind::Invalid,
    );
    assert_eq!(before, snapshot(&s));
    a.relative_path = format!("{oid}/snapshot");
    a.size = MAX_FILE + 1;
    fails(
        s.confirm_preparation_step(
            &p,
            "one",
            &claim,
            &PreparationReceipt::Snapshot {
                artifact: a.clone(),
            },
        ),
        ErrorKind::Invalid,
    );
    a.size = MAX_FILE;
    fails(
        at("after_preparation_receipt", || {
            s.confirm_preparation_step(
                &p,
                "one",
                &claim,
                &PreparationReceipt::Snapshot {
                    artifact: a.clone(),
                },
            )
        }),
        ErrorKind::RecordingFailure,
    );
    assert_eq!(before, snapshot(&s));
    let op = s
        .confirm_preparation_step(
            &p,
            "one",
            &claim,
            &PreparationReceipt::Snapshot { artifact: a },
        )
        .unwrap();
    let op = s.finish_preparation(&p, "one", &oid, op.revision).unwrap();
    match s
        .claim_preparation_step(&p, "one", &oid, op.revision, &spec)
        .unwrap()
    {
        PreparationClaim::Existing {
            claim_id,
            phase,
            receipt,
        } => {
            assert_eq!(claim_id, claim.claim_id());
            assert_eq!(phase, StepPhase::Confirmed);
            assert!(
                matches!(receipt,Some(PreparationReceipt::Snapshot{ref artifact}) if artifact.size==MAX_FILE)
            );
        }
        _ => panic!("a confirmed snapshot cannot qualify a second copy"),
    }
    assert_eq!(op.data.prepared.unwrap().artifacts[0].size, MAX_FILE);
    // Successfully recording this receipt does not silently clear the prior
    // process-wide storage warning. Require the explicit health transaction.
    assert!(s.2.load(Ordering::SeqCst));
    s.verify_ledger_storage_recovery(&p).unwrap();
    assert!(matches!(
        s.claim_preparation_step(&p, "one", &oid, op.revision, &spec)
            .unwrap(),
        PreparationClaim::Existing {
            phase: StepPhase::Confirmed,
            ..
        }
    ));
    let oid = id();
    let body = Intent {
        attachments: (0..4).map(|i| i.to_string()).collect(),
        ..intent()
    };
    s.admit_operation(&p, "one", &oid, &body, &b).unwrap();
    for index in 0..4 {
        let op = get(&s, &p, &oid);
        let permit = match s
            .claim_preparation_step(
                &p,
                "one",
                &oid,
                op.revision,
                &PreparationSpec::Snapshot { index },
            )
            .unwrap()
        {
            PreparationClaim::New(p) => p,
            _ => panic!(),
        };
        s.confirm_preparation_step(
            &p,
            "one",
            &permit,
            &PreparationReceipt::Snapshot {
                artifact: Artifact {
                    index,
                    relative_path: format!("{oid}/{index}"),
                    size: MAX_FILE,
                    sha256: hash(b"fixture"),
                },
            },
        )
        .unwrap();
    }
    let op = get(&s, &p, &oid);
    fails(
        s.finish_preparation(&p, "one", &oid, op.revision),
        ErrorKind::Invalid,
    );
}
#[test]
fn dispatch_acceptance_echo_queue_atomicity_and_result_fence_reconciliation() {
    let (s, p, b) = fresh();
    let oid = id();
    s.admit_queued_operation(&p, "one", &oid, &intent(), &b)
        .unwrap();
    let permit = dispatch(&s, &p, &oid, true);
    let op = get(&s, &p, &oid);
    let rc = receipt(&op);
    let before = snapshot(&s);
    for stage in [
        "after_acceptance",
        "after_echo",
        "after_queue_remove",
        "before_commit",
    ] {
        fails(
            at(stage, || s.record_input_accepted(&p, "one", &permit, &rc)),
            ErrorKind::RecordingFailure,
        );
        assert_eq!(before, snapshot(&s));
    }
    let other = id();
    s.admit_operation(&p, "one", &other, &intent(), &b).unwrap();
    let otherop = ready(&s, &p, &other, false);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    s.verify_ledger_storage_recovery(&p).unwrap();
    assert_eq!(get(&s, &p, &oid).phase, InputPhase::Uncertain);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    let accepted = s.reconcile_input_accepted(&p, "one", &oid, &rc).unwrap();
    assert_eq!(accepted.phase, InputPhase::Accepted);
    assert!(
        s.queue("one").unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let events = s.events("one", 0, 100).unwrap();
    assert_eq!(
        events.iter().filter(|e| e.method == "user/message").count(),
        1
    );
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &oid,
            accepted.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
    assert!(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None
        )
        .is_ok()
    );
}
#[test]
fn queue_take_restore_replace_cancel_preserves_fifo_and_blocks_old_mutators() {
    let (s, p, b) = fresh();
    let old = id();
    let op = s
        .admit_queued_operation(&p, "one", &old, &intent(), &b)
        .unwrap()
        .operation;
    let seq = s.queue("one").unwrap()["items"][0]["id"].as_i64().unwrap();
    assert!(s.queue_write("one", seq, None).is_err());
    assert!(s.queue_begin_edit("one", seq).is_err());
    let before = snapshot(&s);
    fails(
        at("after_queue_edit_copy", || {
            s.take_operation_queue_edit(&p, "one", &old, op.revision, seq)
        }),
        ErrorKind::Storage,
    );
    assert_eq!(before, snapshot(&s));
    let op = s
        .take_operation_queue_edit(&p, "one", &old, op.revision, seq)
        .unwrap();
    assert!(s.queue_restore_edit("one", seq, None).is_err());
    let before = snapshot(&s);
    fails(
        at("after_queue_restore_copy", || {
            s.restore_operation_queue_edit(&p, "one", &old, op.revision, seq)
        }),
        ErrorKind::Storage,
    );
    assert_eq!(before, snapshot(&s));
    let new = id();
    let changed = Intent {
        text: "changed exact intent".into(),
        ..intent()
    };
    for stage in ["after_supersession", "after_queue_replace"] {
        fails(
            at(stage, || {
                s.replace_operation_queue(&p, "one", &old, op.revision, seq, &new, &changed, &b)
            }),
            ErrorKind::Storage,
        );
        assert_eq!(before, snapshot(&s));
    }
    let replaced = s
        .replace_operation_queue(&p, "one", &old, op.revision, seq, &new, &changed, &b)
        .unwrap();
    assert_eq!(get(&s, &p, &old).phase, InputPhase::Superseded);
    assert_eq!(s.queue("one").unwrap()["items"][0]["id"], seq);
    assert!(s.queue("one").unwrap()["editing"].is_null());
    assert!(
        !s.replace_operation_queue(&p, "one", &old, op.revision, seq, &new, &changed, &b)
            .unwrap()
            .created
    );
    let op = s
        .cancel_undispatched_operation(&p, "one", &new, replaced.operation.revision)
        .unwrap();
    assert_eq!(op.phase, InputPhase::Cancelled);
    assert!(
        s.queue("one").unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn legacy_pending_adopts_only_explicitly_unknown_is_never_executable() {
    let (s, p, b) = fresh();
    let value = json!({"text":"legacy","attachments":[],"status":"pending","extra":"preserve"});
    s.enqueue("one", value.clone()).unwrap();
    let seq = s.queue("one").unwrap()["items"][0]["id"].as_i64().unwrap();
    let a = s
        .adopt_legacy_pending(&p, "one", seq, &id(), &value, &b)
        .unwrap();
    assert_eq!(a.operation.phase, InputPhase::Queued);
    assert_eq!(
        queue_data(&s.0.lock().unwrap(), "one", seq, false).unwrap(),
        value
    );
    s.enqueue(
        "one",
        json!({"text":"historical unknown","status":"uncertain"}),
    )
    .unwrap();
    let queue = s.queue("one").unwrap();
    let seq = queue["items"][1]["id"].as_i64().unwrap();
    let expected = queue_data(&s.0.lock().unwrap(), "one", seq, false).unwrap();
    fails(
        s.adopt_legacy_pending(&p, "one", seq, &id(), &expected, &b),
        ErrorKind::IllegalTransition,
    );
}
#[test]
fn goal_is_separate_claim_uncertainty_never_reexecutes_input() {
    let (s, p, b) = fresh();
    let oid = id();
    s.admit_operation(
        &p,
        "one",
        &oid,
        &Intent {
            goal: true,
            ..intent()
        },
        &b,
    )
    .unwrap();
    let permit = dispatch(&s, &p, &oid, false);
    let op = get(&s, &p, &oid);
    let op = s
        .record_input_accepted(&p, "one", &permit, &receipt(&op))
        .unwrap();
    let goal = s
        .claim_operation_goal(&p, "one", &oid, op.revision, None)
        .unwrap();
    assert_eq!(goal.operation_id(), oid);
    assert_eq!(
        Some(goal.claim_id()),
        get(&s, &p, &oid).data.goal_claim_id.as_deref()
    );
    let op = s
        .record_operation_goal(&p, "one", &goal, GoalOutcome::Uncertain)
        .unwrap();
    assert_eq!(op.phase, InputPhase::Accepted);
    assert_eq!(op.goal, GoalPhase::Uncertain);
    fails(
        s.claim_operation_goal(&p, "one", &oid, op.revision, None),
        ErrorKind::IllegalTransition,
    );
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &oid,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
}
#[test]
fn actual_sqlite_readonly_full_and_lock_wait_are_not_absent_success() {
    let (s, p, b) = fresh();
    s.0.lock()
        .unwrap()
        .pragma_update(None, "query_only", true)
        .unwrap();
    fails(
        s.admit_operation(&p, "one", &id(), &intent(), &b),
        ErrorKind::Storage,
    );
    s.0.lock()
        .unwrap()
        .pragma_update(None, "query_only", false)
        .unwrap();
    let pages: i64 =
        s.0.lock()
            .unwrap()
            .pragma_query_value(None, "page_count", |r| r.get(0))
            .unwrap();
    s.0.lock()
        .unwrap()
        .pragma_update(None, "max_page_count", pages)
        .unwrap();
    let oid = id();
    fails(
        s.admit_operation(
            &p,
            "one",
            &oid,
            &Intent {
                text: "x".repeat(2 * 1024 * 1024),
                ..intent()
            },
            &b,
        ),
        ErrorKind::Storage,
    );
    assert!(matches!(
        s.lookup_operation(&p, "one", &oid).unwrap(),
        Lookup::NeverRecorded
    ));
    let f = Fixture::new();
    let s = f.open();
    let p = s.ledger_identity().unwrap();
    let b = seed(&s, "one");
    s.0.lock()
        .unwrap()
        .busy_timeout(std::time::Duration::from_millis(25))
        .unwrap();
    let other = Connection::open(&f.path).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    fails(
        s.admit_operation(&p, "one", &id(), &intent(), &b),
        ErrorKind::Storage,
    );
    other.execute_batch("ROLLBACK").unwrap();
    assert!(s.admit_operation(&p, "one", &id(), &intent(), &b).is_ok());
}

#[test]
#[ignore = "Private child-process crash entry; executed by crash_recovery_real_store test"]
fn crash_child() {
    let Some(path) = std::env::var_os("ANYWORK_LEDGER_TEST_DB") else {
        return;
    };
    let mode = std::env::var("ANYWORK_LEDGER_TEST_MODE").unwrap();
    if mode == "migration_identity" {
        FAIL_AT.with(|v| *v.borrow_mut() = Some("crash_identity"));
        let _store = Store::open(std::path::Path::new(&path)).unwrap();
        panic!("migration crash hook did not run");
    }
    let store = Store::open(std::path::Path::new(&path)).unwrap();
    let p = store.ledger_identity().unwrap();
    let b = seed(&store, "one");
    let oid = std::env::var("ANYWORK_LEDGER_TEST_ID").unwrap();
    let body = Intent {
        goal: mode == "goal",
        ..intent()
    };
    store
        .admit_queued_operation(&p, "one", &oid, &body, &b)
        .unwrap();
    if mode == "preparation" {
        let op = get(&store, &p, &oid);
        let _permit = store
            .claim_preparation_step(&p, "one", &oid, op.revision, &PreparationSpec::ThreadResume)
            .unwrap();
        std::process::exit(29);
    }
    let op = ready(&store, &p, &oid, true);
    store.pause_queue("one", false).unwrap();
    if mode == "before_dispatch_commit" {
        FAIL_AT.with(|v| *v.borrow_mut() = Some("crash_dispatch"));
    }
    let permit = store
        .begin_operation_dispatch(
            &p,
            "one",
            &oid,
            op.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        )
        .unwrap();
    if mode == "accepted" || mode == "goal" {
        let op = get(&store, &p, &oid);
        let op = store
            .record_input_accepted(&p, "one", &permit, &receipt(&op))
            .unwrap();
        if mode == "goal" {
            let _goal = store
                .claim_operation_goal(&p, "one", &oid, op.revision, None)
                .unwrap();
        }
    }
    std::process::exit(29);
}
#[test]
fn crash_recovery_real_store_keeps_identity_pauses_queue_and_never_issues_new_qualification() {
    for mode in [
        "before_dispatch_commit",
        "dispatching",
        "accepted",
        "preparation",
        "goal",
    ] {
        let f = Fixture::new();
        let store = f.open();
        let original = store.ledger_identity().unwrap();
        drop(store);
        let oid = id();
        let child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::operations::tests::crash_child",
                "--ignored",
                "--nocapture",
            ])
            .env("ANYWORK_LEDGER_TEST_DB", &f.path)
            .env("ANYWORK_LEDGER_TEST_MODE", mode)
            .env("ANYWORK_LEDGER_TEST_ID", &oid)
            .output()
            .unwrap();
        assert_eq!(
            child.status.code(),
            Some(29),
            "{mode}: {}",
            String::from_utf8_lossy(&child.stderr)
        );
        let store = f.open();
        assert_eq!(store.ledger_identity().unwrap(), original);
        let op = get(&store, &original, &oid);
        match mode {
            "before_dispatch_commit" => {
                assert_eq!(op.phase, InputPhase::Queued);
                assert!(op.data.dispatch_attempt_id.is_none());
            }
            "dispatching" => {
                assert_eq!(op.phase, InputPhase::Uncertain);
                assert_eq!(op.recording, Recording::RecoveryRequired);
            }
            "accepted" => assert_eq!(op.phase, InputPhase::Accepted),
            "preparation" => {
                assert_eq!(op.preparation, PreparationPhase::Uncertain);
                assert!(matches!(
                    store
                        .claim_preparation_step(
                            &original,
                            "one",
                            &oid,
                            op.revision,
                            &PreparationSpec::ThreadResume
                        )
                        .unwrap(),
                    PreparationClaim::Existing {
                        phase: StepPhase::Uncertain,
                        ..
                    }
                ));
            }
            "goal" => {
                assert_eq!(op.phase, InputPhase::Accepted);
                assert_eq!(op.goal, GoalPhase::Uncertain);
                assert_eq!(op.recording, Recording::RecoveryRequired);
            }
            _ => unreachable!(),
        }
        if mode != "accepted" && mode != "goal" {
            assert_eq!(store.queue("one").unwrap()["paused"], true);
        }
        let before = snapshot(&store);
        drop(store);
        let again = f.open();
        assert_eq!(snapshot(&again), before);
    }
}
#[test]
fn migration_v1_v2_is_real_identity_failure_rolls_back_and_malformed_v2_is_not_repaired() {
    let f = Fixture::new();
    {
        let db = Connection::open(&f.path).unwrap();
        db.execute_batch(include_str!("../fixtures/schema-v1-current.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 1).unwrap();
        db.execute(
            "INSERT INTO sessions VALUES('one',?1)",
            [serde_json::to_string(&sample_session("one")).unwrap()],
        )
        .unwrap();
        let event = Event {
            seq: 0,
            session_id: "one".into(),
            method: "user/message".into(),
            params: json!({"text":"EXACT quoted 文本","sourceEventKey":"MiXeD-\"source\""}),
            request_id: None,
            created_at: 1,
        };
        db.execute(
            "INSERT INTO events(seq,session_id,data) VALUES(900,'one',?1)",
            [serde_json::to_string(&event).unwrap()],
        )
        .unwrap();
        db.execute("DELETE FROM events WHERE seq=900", []).unwrap();
    }
    let result = at("after_identity", || Store::open(&f.path));
    assert!(result.is_err());
    {
        let db = Connection::open(&f.path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='message_ledger_identity'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
    let store = f.open();
    let p = store.ledger_identity().unwrap();
    assert_eq!(
        store.event("one", "fixture", json!({}), None).unwrap().seq,
        901
    );
    drop(store);
    let store = f.open();
    assert_eq!(p, store.ledger_identity().unwrap());
    drop(store);
    {
        let db = Connection::open(&f.path).unwrap();
        db.execute("DELETE FROM message_ledger_identity", [])
            .unwrap();
    }
    assert!(Store::open(&f.path).is_err());
    let db = Connection::open(&f.path).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM message_ledger_identity", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn native_preparation_uncertainty_requires_exact_claim_reconcile_or_abandon() {
    let (s, p, mut b) = fresh();
    let mut session = s.session("one").unwrap();
    session.thread_id = None;
    s.save(&session).unwrap();
    b.thread_id = None;
    let a = id();
    let op = s
        .admit_operation(&p, "one", &a, &intent(), &b)
        .unwrap()
        .operation;
    let claim = match s
        .claim_preparation_step(&p, "one", &a, op.revision, &PreparationSpec::ThreadStart)
        .unwrap()
    {
        PreparationClaim::New(p) => p,
        _ => panic!(),
    };
    let other = id();
    let op2 = s
        .admit_operation(&p, "one", &other, &intent(), &b)
        .unwrap()
        .operation;
    fails(
        s.claim_preparation_step(
            &p,
            "one",
            &other,
            op2.revision,
            &PreparationSpec::ThreadStart,
        ),
        ErrorKind::Fenced,
    );
    s.fail_preparation_step(&p, "one", &claim, true).unwrap();
    fails(
        s.claim_preparation_step(
            &p,
            "one",
            &other,
            op2.revision,
            &PreparationSpec::ThreadStart,
        ),
        ErrorKind::Fenced,
    );
    fails(
        s.reconcile_preparation_receipt(
            &p,
            "one",
            &a,
            &id(),
            &PreparationReceipt::Thread {
                thread_id: "created-once".into(),
                instance_id: Some("instance".into()),
                native_version: Some("fixture-version".into()),
            },
        ),
        ErrorKind::Missing,
    );
    let op = s
        .reconcile_preparation_receipt(
            &p,
            "one",
            &a,
            claim.claim_id(),
            &PreparationReceipt::Thread {
                thread_id: "created-once".into(),
                instance_id: Some("instance".into()),
                native_version: Some("fixture-version".into()),
            },
        )
        .unwrap();
    assert_eq!(
        s.session("one").unwrap().thread_id.as_deref(),
        Some("created-once")
    );
    let op = s.finish_preparation(&p, "one", &a, op.revision).unwrap();
    assert_eq!(op.data.binding.thread_id.as_deref(), Some("created-once"));
    fails(
        s.finish_preparation(&p, "one", &other, op2.revision),
        ErrorKind::BindingConflict,
    );
}
#[test]
fn pre_input_rejection_and_exact_negative_reconcile_do_not_reactivate_unknown() {
    let (s, p, b) = fresh();
    let a = id();
    let op = s
        .admit_queued_operation(&p, "one", &a, &intent(), &b)
        .unwrap()
        .operation;
    let op = s
        .reject_before_input(&p, "one", &a, op.revision, Rejection::Validation)
        .unwrap();
    assert_eq!(op.phase, InputPhase::Rejected);
    assert!(op.data.dispatch_attempt_id.is_none());
    s.detach_rejected_queue(&p, "one", &a, op.revision).unwrap();
    let a = id();
    s.admit_operation(&p, "one", &a, &intent(), &b).unwrap();
    let permit = dispatch(&s, &p, &a, false);
    let op = s.record_input_uncertain(&p, "one", &permit).unwrap();
    fails(
        s.cancel_undispatched_operation(&p, "one", &a, op.revision),
        ErrorKind::IllegalTransition,
    );
    let mut proof = NotAcceptedObservation {
        thread_id: op.data.binding.thread_id.clone().unwrap(),
        client_user_message_id: id(),
        native_request_id: None,
        proof_id: "verified-native-query-key".into(),
    };
    fails(
        s.reconcile_input_rejected(&p, "one", &a, &proof),
        ErrorKind::BindingConflict,
    );
    proof.client_user_message_id = op.data.client_user_message_id;
    let op = s.reconcile_input_rejected(&p, "one", &a, &proof).unwrap();
    assert_eq!(
        op.data.rejection_proof.as_deref(),
        Some("verified-native-query-key")
    );
    assert_eq!(op.phase, InputPhase::Rejected);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &a,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
}
#[test]
fn real_readonly_post_result_failure_fences_alias_and_health_does_not_erase_unknown() {
    let (s, p, b) = fresh();
    let a = id();
    s.admit_operation(&p, "one", &a, &intent(), &b).unwrap();
    let permit = dispatch(&s, &p, &a, false);
    let rc = receipt(&get(&s, &p, &a));
    s.0.lock()
        .unwrap()
        .pragma_update(None, "query_only", true)
        .unwrap();
    fails(
        s.record_input_accepted(&p, "one", &permit, &rc),
        ErrorKind::RecordingFailure,
    );
    fails(s.verify_ledger_storage_recovery(&p), ErrorKind::Storage);
    assert!(s.2.load(Ordering::SeqCst));
    s.0.lock()
        .unwrap()
        .pragma_update(None, "query_only", false)
        .unwrap();
    s.verify_ledger_storage_recovery(&p).unwrap();
    let original = get(&s, &p, &a);
    assert_eq!(original.phase, InputPhase::Uncertain);
    assert_eq!(original.recording, Recording::RecoveryRequired);
    let mut alias = sample_session("alias");
    alias.thread_id = b.thread_id.clone();
    s.save(&alias).unwrap();
    let aid = id();
    let op = s
        .admit_operation(&p, "alias", &aid, &intent(), &b)
        .unwrap()
        .operation;
    let op = s
        .select_operation_route(&p, "alias", &aid, op.revision, Route::Start, None)
        .unwrap();
    let op = s
        .finish_preparation(&p, "alias", &aid, op.revision)
        .unwrap();
    fails(
        s.begin_operation_dispatch(
            &p,
            "alias",
            &aid,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    s.reconcile_input_accepted(&p, "one", &a, &rc).unwrap();
    assert!(
        s.begin_operation_dispatch(
            &p,
            "alias",
            &aid,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None
        )
        .is_ok()
    );
}
#[test]
fn goal_result_failure_is_persistent_and_reconciles_separately_from_accepted_input() {
    let (s, p, b) = fresh();
    let a = id();
    s.admit_operation(
        &p,
        "one",
        &a,
        &Intent {
            goal: true,
            ..intent()
        },
        &b,
    )
    .unwrap();
    let permit = dispatch(&s, &p, &a, false);
    let op = get(&s, &p, &a);
    let op = s
        .record_input_accepted(&p, "one", &permit, &receipt(&op))
        .unwrap();
    let claim = s
        .claim_operation_goal(&p, "one", &a, op.revision, None)
        .unwrap();
    let goal = GoalReceipt {
        goal_id: "goal-native-id".into(),
        thread_id: b.thread_id.clone().unwrap(),
    };
    fails(
        at("before_commit", || {
            s.record_operation_goal(&p, "one", &claim, GoalOutcome::Accepted(goal.clone()))
        }),
        ErrorKind::RecordingFailure,
    );
    s.verify_ledger_storage_recovery(&p).unwrap();
    let op = get(&s, &p, &a);
    assert_eq!(op.phase, InputPhase::Accepted);
    assert_eq!(op.goal, GoalPhase::Uncertain);
    assert_eq!(op.recording, Recording::RecoveryRequired);
    let op = s.reconcile_operation_goal(&p, "one", &a, &goal).unwrap();
    assert_eq!(op.goal, GoalPhase::Accepted);
    assert_eq!(op.recording, Recording::Normal);
    assert_eq!(
        s.events("one", 0, 100)
            .unwrap()
            .iter()
            .filter(|e| e.method == "user/message")
            .count(),
        1
    );
}
#[test]
fn recorded_busy_routing_then_queue_admission_and_fifo_are_checked() {
    let (s, p, b) = fresh();
    let a = id();
    let op = s
        .admit_operation(&p, "one", &a, &intent(), &b)
        .unwrap()
        .operation;
    let op = s
        .queue_recorded_operation(&p, "one", &a, op.revision)
        .unwrap();
    assert_eq!(op.phase, InputPhase::Queued);
    assert!(
        !s.admit_queued_operation(&p, "one", &a, &intent(), &b)
            .unwrap()
            .created
    );
    assert_eq!(
        s.queue("one").unwrap()["items"].as_array().unwrap().len(),
        1
    );
    let second = id();
    s.admit_queued_operation(&p, "one", &second, &intent(), &b)
        .unwrap();
    let secondop = ready(&s, &p, &second, true);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &second,
            secondop.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        ),
        ErrorKind::Conflict,
    );
    let op = ready(&s, &p, &a, true);
    s.pause_queue("one", true).unwrap();
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &a,
            op.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
}
#[test]
fn malformed_v2_and_failed_reads_do_not_authorize_never_recorded_or_mutate_recovery() {
    let f = Fixture::new();
    let s = f.open();
    seed(&s, "one");
    drop(s);
    {
        let db = Connection::open(&f.path).unwrap();
        db.execute(
            "UPDATE sessions SET data=json_set(data,'$.status','running') WHERE id='one'",
            [],
        )
        .unwrap();
        db.execute(
            "UPDATE message_ledger_identity SET store_id='malformed'",
            [],
        )
        .unwrap();
    }
    assert!(Store::open(&f.path).is_err());
    let db = Connection::open(&f.path).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT json_extract(data,'$.status') FROM sessions WHERE id='one'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "running"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM events", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(db);
    let (s, p, b) = fresh();
    let a = id();
    s.admit_operation(&p, "one", &a, &intent(), &b).unwrap();
    {
        let db = s.0.lock().unwrap();
        db.execute_batch("PRAGMA foreign_keys=OFF; DELETE FROM message_operation_ids;")
            .unwrap();
    }
    fails(s.lookup_operation(&p, "one", &a), ErrorKind::Corrupt);
}
#[test]
fn workbuddy_exact_native_identity_is_durable_not_a_native_retry_promise() {
    let f = Fixture::new();
    let s = f.open();
    let mut session = sample_session("one");
    session.agent = "workbuddy".into();
    session.external = true;
    s.save(&session).unwrap();
    let p = s.ledger_identity().unwrap();
    let b = Binding {
        agent: session.agent,
        topology: Topology::SharedHost,
        thread_id: session.thread_id,
        instance_id: Some("fixture-renderer-instance".into()),
        native_version: Some("5.9.3".into()),
    };
    let a = id();
    let op = s
        .admit_operation(&p, "one", &a, &intent(), &b)
        .unwrap()
        .operation;
    let native = op.data.native_request_id.unwrap();
    assert_eq!(Uuid::parse_str(&native).unwrap().get_version_num(), 7);
    assert_eq!(native.len(), 32);
    assert_eq!(op.data.client_user_message_id, a);
    drop(s);
    let s = f.open();
    assert_eq!(
        get(&s, &p, &a).data.native_request_id.as_deref(),
        Some(native.as_str())
    );
}

#[test]
fn receipts_require_exact_thread_and_observed_item_not_turn_ack_or_local_echo() {
    let (s, p, b) = fresh();
    let oid = id();
    s.admit_operation(&p, "one", &oid, &intent(), &b).unwrap();
    let permit = dispatch(&s, &p, &oid, false);
    let op = get(&s, &p, &oid);
    let mut observed = receipt(&op);
    observed.thread_id = "other-thread".into();
    let before = snapshot(&s);
    fails(
        s.record_input_accepted(&p, "one", &permit, &observed),
        ErrorKind::BindingConflict,
    );
    assert_eq!(snapshot(&s), before);
    observed.thread_id = op.data.binding.thread_id.clone().unwrap();
    observed.native_item_id.clear();
    fails(
        s.record_input_accepted(&p, "one", &permit, &observed),
        ErrorKind::Invalid,
    );
    assert_eq!(snapshot(&s), before);
    let op = s.record_input_uncertain(&p, "one", &permit).unwrap();
    let wrong = NotAcceptedObservation {
        thread_id: "other-thread".into(),
        client_user_message_id: op.data.client_user_message_id.clone(),
        native_request_id: op.data.native_request_id.clone(),
        proof_id: "exact-negative-query".into(),
    };
    fails(
        s.reconcile_input_rejected(&p, "one", &oid, &wrong),
        ErrorKind::BindingConflict,
    );
    let op = s
        .reconcile_input_accepted(&p, "one", &oid, &receipt(&op))
        .unwrap();
    assert_eq!(op.phase, InputPhase::Accepted);
}

#[test]
fn upload_requires_snapshot_and_prepared_bundle_must_match_durable_receipts() {
    let f = Fixture::new();
    let s = f.open();
    let b = seed(&s, "one");
    let p = s.ledger_identity().unwrap();
    let oid = id();
    let body = Intent {
        attachments: vec!["source".into()],
        ..intent()
    };
    let op = s
        .admit_operation(&p, "one", &oid, &body, &b)
        .unwrap()
        .operation;
    fails(
        s.claim_preparation_step(
            &p,
            "one",
            &oid,
            op.revision,
            &PreparationSpec::Upload { index: 0 },
        ),
        ErrorKind::IllegalTransition,
    );
    let permit = match s
        .claim_preparation_step(
            &p,
            "one",
            &oid,
            op.revision,
            &PreparationSpec::Snapshot { index: 0 },
        )
        .unwrap()
    {
        PreparationClaim::New(p) => p,
        _ => panic!(),
    };
    let op = s
        .confirm_preparation_step(
            &p,
            "one",
            &permit,
            &PreparationReceipt::Snapshot {
                artifact: Artifact {
                    index: 0,
                    relative_path: format!("{oid}/frozen"),
                    size: 3,
                    sha256: hash(b"abc"),
                },
            },
        )
        .unwrap();
    let permit = match s
        .claim_preparation_step(
            &p,
            "one",
            &oid,
            op.revision,
            &PreparationSpec::Upload { index: 0 },
        )
        .unwrap()
    {
        PreparationClaim::New(p) => p,
        _ => panic!(),
    };
    let op = s
        .confirm_preparation_step(
            &p,
            "one",
            &permit,
            &PreparationReceipt::Upload {
                index: 0,
                native_file_id: "native-frozen-file".into(),
            },
        )
        .unwrap();
    let op = s.finish_preparation(&p, "one", &oid, op.revision).unwrap();
    assert_eq!(
        op.data.prepared.as_ref().unwrap().uploads,
        vec![(0, "native-frozen-file".into())]
    );
    drop(s);
    let s = f.open();
    assert_eq!(get(&s, &p, &oid).data.prepared, op.data.prepared);
    drop(s);
    {
        let db = Connection::open(&f.path).unwrap();
        db.execute("UPDATE message_operations SET data=json_set(data,'$.prepared.artifacts[0].sha256',?2) WHERE operation_id=?1",params![oid,hash(b"forged")]).unwrap();
    }
    assert!(Store::open(&f.path).is_err());
    let db = Connection::open(&f.path).unwrap();
    let actual:String=db.query_row("SELECT json_extract(data,'$.prepared.artifacts[0].sha256') FROM message_operations WHERE operation_id=?1",[oid],|r|r.get(0)).unwrap();
    assert_eq!(actual, hash(b"forged"));
}

#[test]
fn actual_process_exit_during_v2_identity_migration_rolls_back_registry_and_version() {
    let f = Fixture::new();
    {
        let db = Connection::open(&f.path).unwrap();
        db.execute_batch(include_str!("../fixtures/schema-v1-current.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 1).unwrap();
    }
    let child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "store::operations::tests::crash_child",
            "--ignored",
            "--nocapture",
        ])
        .env("ANYWORK_LEDGER_TEST_DB", &f.path)
        .env("ANYWORK_LEDGER_TEST_MODE", "migration_identity")
        .output()
        .unwrap();
    assert_eq!(
        child.status.code(),
        Some(29),
        "{}",
        String::from_utf8_lossy(&child.stderr)
    );
    {
        let db = Connection::open(&f.path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(db.query_row("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'message_operation%' OR name='message_ledger_identity'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    let s = f.open();
    let p = s.ledger_identity().unwrap();
    drop(s);
    assert_eq!(f.open().ledger_identity().unwrap(), p);
}

#[test]
fn explicit_rejection_and_goal_rejection_remain_terminal_and_have_independent_input() {
    let (s, p, b) = fresh();
    let oid = id();
    let body = Intent {
        goal: true,
        ..intent()
    };
    s.admit_operation(&p, "one", &oid, &body, &b).unwrap();
    let permit = dispatch(&s, &p, &oid, false);
    let op = s
        .record_input_rejected(&p, "one", &permit, Rejection::NativeExplicit)
        .unwrap();
    assert_eq!(
        (op.phase, op.goal),
        (InputPhase::Rejected, GoalPhase::Rejected)
    );
    fails(
        s.record_input_accepted(&p, "one", &permit, &receipt(&op)),
        ErrorKind::IllegalTransition,
    );
    let oid = id();
    s.admit_operation(&p, "one", &oid, &body, &b).unwrap();
    let permit = dispatch(&s, &p, &oid, false);
    let op = get(&s, &p, &oid);
    let op = s
        .record_input_accepted(&p, "one", &permit, &receipt(&op))
        .unwrap();
    let permit = s
        .claim_operation_goal(&p, "one", &oid, op.revision, None)
        .unwrap();
    let op = s
        .record_operation_goal(&p, "one", &permit, GoalOutcome::Rejected)
        .unwrap();
    assert_eq!(
        (op.phase, op.goal),
        (InputPhase::Accepted, GoalPhase::Rejected)
    );
    fails(
        s.claim_operation_goal(&p, "one", &oid, op.revision, None),
        ErrorKind::IllegalTransition,
    );
    let parsed: Intent = serde_json::from_value(json!({"text":"x","mode":null})).unwrap();
    assert_eq!(parsed.mode, Mode::Auto);
}

#[test]
fn detach_unknown_queue_removes_display_only_and_never_requalifies_input() {
    let (s, p, b) = fresh();
    let oid = id();
    s.admit_queued_operation(&p, "one", &oid, &intent(), &b)
        .unwrap();
    let permit = dispatch(&s, &p, &oid, true);
    let op = s.record_input_uncertain(&p, "one", &permit).unwrap();
    let attempt = op.data.dispatch_attempt_id.clone();
    let op = s
        .detach_uncertain_queue(&p, "one", &oid, op.revision)
        .unwrap();
    assert_eq!(op.phase, InputPhase::Uncertain);
    assert_eq!(op.data.dispatch_attempt_id, attempt);
    assert!(
        s.queue("one").unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &oid,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
}

#[test]
fn native_preparation_result_storage_failure_fences_input_and_recovers_without_reinvocation() {
    let (s, p, b) = fresh();
    let a = id();
    let op = s
        .admit_operation(&p, "one", &a, &intent(), &b)
        .unwrap()
        .operation;
    let permit = match s
        .claim_preparation_step(&p, "one", &a, op.revision, &PreparationSpec::ThreadResume)
        .unwrap()
    {
        PreparationClaim::New(p) => p,
        _ => panic!(),
    };
    // This second operation was prepared before the native resume result. It
    // cannot cross input dispatch while another native preparation is in flight.
    let other = id();
    s.admit_operation(&p, "one", &other, &intent(), &b).unwrap();
    let otherop = ready(&s, &p, &other, false);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    let receipt = PreparationReceipt::Thread {
        thread_id: b.thread_id.clone().unwrap(),
        instance_id: None,
        native_version: None,
    };
    s.0.lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=ON")
        .unwrap();
    fails(
        s.confirm_preparation_step(&p, "one", &permit, &receipt),
        ErrorKind::RecordingFailure,
    );
    s.0.lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=OFF")
        .unwrap();
    assert!(s.2.load(Ordering::SeqCst));
    s.verify_ledger_storage_recovery(&p).unwrap();
    assert_eq!(get(&s, &p, &a).preparation, PreparationPhase::Uncertain);
    assert!(matches!(
        s.claim_preparation_step(
            &p,
            "one",
            &a,
            get(&s, &p, &a).revision,
            &PreparationSpec::ThreadResume
        )
        .unwrap(),
        PreparationClaim::Existing {
            phase: StepPhase::Uncertain,
            ..
        }
    ));
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    let op = s
        .reconcile_preparation_receipt(&p, "one", &a, permit.claim_id(), &receipt)
        .unwrap();
    s.finish_preparation(&p, "one", &a, op.revision).unwrap();
    assert!(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            otherop.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None
        )
        .is_ok()
    );
}

#[test]
fn recording_fence_survives_same_session_native_thread_retarget() {
    let (s, p, b) = fresh();
    let a = id();
    s.admit_operation(&p, "one", &a, &intent(), &b).unwrap();
    let permit = dispatch(&s, &p, &a, false);
    let op = get(&s, &p, &a);
    fails(
        at("after_acceptance", || {
            s.record_input_accepted(&p, "one", &permit, &receipt(&op))
        }),
        ErrorKind::RecordingFailure,
    );
    s.verify_ledger_storage_recovery(&p).unwrap();
    let mut session = s.session("one").unwrap();
    session.thread_id = Some("replacement-thread".into());
    s.save(&session).unwrap();
    let mut binding = b;
    binding.thread_id = session.thread_id;
    let other = id();
    s.admit_operation(&p, "one", &other, &intent(), &binding)
        .unwrap();
    let op = ready(&s, &p, &other, false);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &other,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
}

#[test]
fn admitted_canonical_depth_boundary_remains_readable_after_real_open() {
    let f = Fixture::new();
    let s = f.open();
    let p = s.ledger_identity().unwrap();
    let b = seed(&s, "one");
    let mut accepted = vec![];
    let literal = "[literal] {not nesting} \"quoted\" \\ 界 é e\u{301}";
    for nested in 120..=130 {
        let mut content = json!([]);
        for _ in 0..nested {
            content = json!([content]);
        }
        let body = Intent {
            text: literal.into(),
            composer: Some(Composer {
                markdown: literal.into(),
                document: json!({"type":"doc","content":content,"note":literal}),
            }),
            ..intent()
        };
        let oid = id();
        if nested <= 125 {
            // root=0, composer=1, document=2, content=3; the final empty
            // array reaches depth 128 at nested=125.
            let canonical = body.canonical().unwrap();
            if nested == 125 {
                assert!(
                    serde_json::from_str::<Intent>(&canonical.bytes).is_err(),
                    "other decoders retain their default recursion guard"
                );
            }
            s.admit_operation(&p, "one", &oid, &body, &b)
                .unwrap_or_else(|e| {
                    panic!("canonical depth case {nested} was not durably admissible: {e}")
                });
            assert_eq!(get(&s, &p, &oid).intent().unwrap(), body);
            accepted.push((oid, body));
        } else {
            let before = snapshot(&s);
            fails(
                s.admit_operation(&p, "one", &oid, &body, &b),
                ErrorKind::Invalid,
            );
            assert_eq!(
                snapshot(&s),
                before,
                "depth +1 must not create even a used-ID row"
            );
        }
    }
    let oversized = Intent {
        text: "界".repeat(MAX_CANONICAL / 3 + 1),
        ..intent()
    };
    let before = snapshot(&s);
    fails(
        s.admit_operation(&p, "one", &id(), &oversized, &b),
        ErrorKind::Invalid,
    );
    assert_eq!(
        snapshot(&s),
        before,
        "byte budget is UTF-8 bytes, not code points"
    );
    // Lexical nesting ignores escaped quotes, backslashes and structural
    // characters inside strings, and refuses deep hostile saved input before
    // the parser's default recursion guard is disabled.
    let raw = format!("{}0{}", "[".repeat(130), "]".repeat(130));
    fails(decode_intent(&raw), ErrorKind::Corrupt);
    drop(s);
    let reopened = f.open();
    for (oid, body) in accepted {
        assert_eq!(get(&reopened, &p, &oid).intent().unwrap(), body);
    }
}

fn linked_seq(s: &Store, oid: &str) -> i64 {
    s.0.lock()
        .unwrap()
        .query_row(
            "SELECT queue_seq FROM message_operation_queue WHERE operation_id=?1",
            [oid],
            |r| r.get(0),
        )
        .unwrap()
}
fn queued_ready(s: &Store, p: &Identity, b: &Binding) -> String {
    let oid = id();
    s.admit_queued_operation(p, "one", &oid, &intent(), b)
        .unwrap();
    ready(s, p, &oid, true);
    oid
}
fn denied_dispatch_unchanged(
    s: &Store,
    p: &Identity,
    oid: &str,
    authority: DispatchAuthority,
    route: Route,
    turn: Option<&str>,
    kind: ErrorKind,
) {
    let op = get(s, p, oid);
    let before = snapshot(s);
    fails(
        s.begin_operation_dispatch(p, "one", oid, op.revision, authority, route, turn),
        kind,
    );
    assert_eq!(
        snapshot(s),
        before,
        "denial must return no qualification and commit no operation/queue/event change"
    );
}

#[test]
fn fenced_absence_is_not_authoritative_but_existing_and_tombstone_remain_inspectable() {
    let (s, p, b) = fresh();
    let tomb = id();
    s.admit_operation(&p, "one", &tomb, &intent(), &b).unwrap();
    // Preserve a permanent registry entry while deleting only its private detail.
    s.0.lock()
        .unwrap()
        .execute(
            "DELETE FROM message_operations WHERE operation_id=?1",
            [&tomb],
        )
        .unwrap();
    let active = id();
    s.admit_operation(&p, "one", &active, &intent(), &b)
        .unwrap();
    let permit = dispatch(&s, &p, &active, false);
    let op = get(&s, &p, &active);
    let prep_binding = seed(&s, "two");
    let prep = id();
    let prep_op = s
        .admit_operation(&p, "two", &prep, &intent(), &prep_binding)
        .unwrap()
        .operation;
    let _prep_permit = s
        .claim_preparation_step(
            &p,
            "two",
            &prep,
            prep_op.revision,
            &PreparationSpec::ThreadResume,
        )
        .unwrap();
    let missing = id();
    assert!(matches!(
        s.lookup_operation(&p, "one", &missing).unwrap(),
        Lookup::NeverRecorded
    ));
    s.0.lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=ON")
        .unwrap();
    fails(
        s.record_input_accepted(&p, "one", &permit, &receipt(&op)),
        ErrorKind::RecordingFailure,
    );
    assert!(s.2.load(Ordering::SeqCst));
    assert!(matches!(
        s.lookup_operation(&p, "one", &active).unwrap(),
        Lookup::Found(_)
    ));
    assert!(matches!(
        s.lookup_operation(&p, "one", &tomb).unwrap(),
        Lookup::Tombstone
    ));
    let before = snapshot(&s);
    fails(s.lookup_operation(&p, "one", &missing), ErrorKind::Fenced);
    assert_eq!(snapshot(&s), before);
    fails(s.verify_ledger_storage_recovery(&p), ErrorKind::Storage);
    fails(s.lookup_operation(&p, "one", &missing), ErrorKind::Fenced);
    s.0.lock()
        .unwrap()
        .execute_batch("PRAGMA query_only=OFF")
        .unwrap();
    // Readability without the explicitly verified recovery still cannot prove absence.
    fails(s.lookup_operation(&p, "one", &missing), ErrorKind::Fenced);
    s.verify_ledger_storage_recovery(&p).unwrap();
    assert!(matches!(
        s.lookup_operation(&p, "one", &missing).unwrap(),
        Lookup::NeverRecorded
    ));
    let recovered = get(&s, &p, &active);
    assert_eq!(
        (recovered.phase, recovered.recording),
        (InputPhase::Uncertain, Recording::RecoveryRequired)
    );
    let recovered = match s.lookup_operation(&p, "two", &prep).unwrap() {
        Lookup::Found(op) => op,
        _ => panic!(),
    };
    assert_eq!(recovered.preparation, PreparationPhase::Uncertain);
    let later = id();
    s.admit_operation(&p, "one", &later, &intent(), &b).unwrap();
    ready(&s, &p, &later, false);
    denied_dispatch_unchanged(
        &s,
        &p,
        &later,
        DispatchAuthority::Immediate,
        Route::Start,
        None,
        ErrorKind::Fenced,
    );
    let later = id();
    let op = s
        .admit_operation(&p, "two", &later, &intent(), &prep_binding)
        .unwrap()
        .operation;
    let op = s
        .select_operation_route(&p, "two", &later, op.revision, Route::Start, None)
        .unwrap();
    let op = s
        .finish_preparation(&p, "two", &later, op.revision)
        .unwrap();
    let before = snapshot(&s);
    fails(
        s.begin_operation_dispatch(
            &p,
            "two",
            &later,
            op.revision,
            DispatchAuthority::Immediate,
            Route::Start,
            None,
        ),
        ErrorKind::Fenced,
    );
    assert_eq!(snapshot(&s), before);
}

#[test]
fn worker_respects_editor_head_across_restore_cancel_and_replace_without_renumbering() {
    for replace in [false, true] {
        let (s, p, b) = fresh();
        let head = queued_ready(&s, &p, &b);
        let tail = queued_ready(&s, &p, &b);
        let seq = linked_seq(&s, &head);
        let op = get(&s, &p, &head);
        s.take_operation_queue_edit(&p, "one", &head, op.revision, seq)
            .unwrap();
        denied_dispatch_unchanged(
            &s,
            &p,
            &tail,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
            ErrorKind::Conflict,
        );
        denied_dispatch_unchanged(
            &s,
            &p,
            &tail,
            DispatchAuthority::QueueWorker,
            Route::Steer,
            Some("turn-current"),
            ErrorKind::Invalid,
        );
        let current_head = if replace {
            let replacement = id();
            let op = get(&s, &p, &head);
            let changed = Intent {
                text: "edited head".into(),
                ..intent()
            };
            s.replace_operation_queue(
                &p,
                "one",
                &head,
                op.revision,
                seq,
                &replacement,
                &changed,
                &b,
            )
            .unwrap();
            ready(&s, &p, &replacement, true);
            assert_eq!(get(&s, &p, &head).phase, InputPhase::Superseded);
            assert_eq!(linked_seq(&s, &replacement), seq);
            replacement
        } else {
            let op = get(&s, &p, &head);
            s.restore_operation_queue_edit(&p, "one", &head, op.revision, seq)
                .unwrap();
            assert_eq!(linked_seq(&s, &head), seq);
            head
        };
        denied_dispatch_unchanged(
            &s,
            &p,
            &tail,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
            ErrorKind::Conflict,
        );
        let op = get(&s, &p, &current_head);
        s.cancel_undispatched_operation(&p, "one", &current_head, op.revision)
            .unwrap();
        let op = get(&s, &p, &tail);
        let permit = s
            .begin_operation_dispatch(
                &p,
                "one",
                &tail,
                op.revision,
                DispatchAuthority::QueueWorker,
                Route::Start,
                None,
            )
            .unwrap();
        assert_eq!(permit.operation_id(), tail);
        assert_eq!(
            get(&s, &p, &tail).data.dispatch_authority,
            Some(DispatchAuthority::QueueWorker)
        );
    }
}

#[test]
fn edited_middle_allows_earlier_worker_but_blocks_later_and_selected_editor_never_dispatches() {
    let (s, p, b) = fresh();
    let head = queued_ready(&s, &p, &b);
    let middle = queued_ready(&s, &p, &b);
    let tail = queued_ready(&s, &p, &b);
    let op = get(&s, &p, &middle);
    s.take_operation_queue_edit(&p, "one", &middle, op.revision, linked_seq(&s, &middle))
        .unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &middle,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
    let op = get(&s, &p, &head);
    let permit = s
        .begin_operation_dispatch(
            &p,
            "one",
            &head,
            op.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        )
        .unwrap();
    let op = get(&s, &p, &head);
    s.record_input_accepted(&p, "one", &permit, &receipt(&op))
        .unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &tail,
        DispatchAuthority::QueueWorker,
        Route::Start,
        None,
        ErrorKind::Conflict,
    );
    assert_eq!(
        s.queue("one").unwrap()["editing"]["id"],
        linked_seq(&s, &middle)
    );
}

#[test]
fn restart_keeps_editor_fifo_identity_and_requires_unpause_without_overtaking() {
    let f = Fixture::new();
    let s = f.open();
    let p = s.ledger_identity().unwrap();
    let b = seed(&s, "one");
    let head = queued_ready(&s, &p, &b);
    let tail = queued_ready(&s, &p, &b);
    let seq = linked_seq(&s, &head);
    let op = get(&s, &p, &head);
    s.take_operation_queue_edit(&p, "one", &head, op.revision, seq)
        .unwrap();
    drop(s);
    let s = f.open();
    assert_eq!(s.queue("one").unwrap()["paused"], true);
    assert_eq!(linked_seq(&s, &head), seq);
    s.pause_queue("one", false).unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &tail,
        DispatchAuthority::QueueWorker,
        Route::Start,
        None,
        ErrorKind::Conflict,
    );
    let op = get(&s, &p, &head);
    s.restore_operation_queue_edit(&p, "one", &head, op.revision, seq)
        .unwrap();
    let op = get(&s, &p, &head);
    let permit = s
        .begin_operation_dispatch(
            &p,
            "one",
            &head,
            op.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        )
        .unwrap();
    let op = get(&s, &p, &head);
    s.record_input_accepted(&p, "one", &permit, &receipt(&op))
        .unwrap();
    drop(s);
    let s = f.open();
    assert_eq!(
        get(&s, &p, &head).data.dispatch_authority,
        Some(DispatchAuthority::QueueWorker)
    );
    assert_eq!(get(&s, &p, &head).phase, InputPhase::Accepted);
    let op = get(&s, &p, &tail);
    fails(
        s.begin_operation_dispatch(
            &p,
            "one",
            &tail,
            op.revision,
            DispatchAuthority::QueueWorker,
            Route::Start,
            None,
        ),
        ErrorKind::IllegalTransition,
    );
}

#[test]
fn explicit_paused_nonhead_selection_supports_idle_start_and_active_steer_without_changing_others()
{
    for (route, turn) in [
        (Route::Start, None),
        (Route::Steer, Some("exact-active-turn")),
    ] {
        let (s, p, b) = fresh();
        let head = queued_ready(&s, &p, &b);
        let selected = queued_ready(&s, &p, &b);
        let head_seq = linked_seq(&s, &head);
        let op = get(&s, &p, &head);
        s.take_operation_queue_edit(&p, "one", &head, op.revision, head_seq)
            .unwrap();
        s.pause_queue("one", true).unwrap();
        let queue = s.queue("one").unwrap();
        let head_before = get(&s, &p, &head).revision;
        denied_dispatch_unchanged(
            &s,
            &p,
            &selected,
            DispatchAuthority::QueueWorker,
            Route::Steer,
            turn.or(Some("exact-active-turn")),
            ErrorKind::Invalid,
        );
        denied_dispatch_unchanged(
            &s,
            &p,
            &selected,
            DispatchAuthority::Immediate,
            route,
            turn,
            ErrorKind::IllegalTransition,
        );
        let op = get(&s, &p, &selected);
        let permit = s
            .begin_operation_dispatch(
                &p,
                "one",
                &selected,
                op.revision,
                DispatchAuthority::ExplicitQueueSelection,
                route,
                turn,
            )
            .unwrap();
        let op = get(&s, &p, &selected);
        assert_eq!(
            op.data.dispatch_authority,
            Some(DispatchAuthority::ExplicitQueueSelection)
        );
        assert_eq!(op.data.dispatch_route, Some(route));
        assert_eq!(op.data.expected_turn.as_deref(), turn);
        assert_eq!(s.queue("one").unwrap()["paused"], true);
        assert_eq!(s.queue("one").unwrap()["editing"], queue["editing"]);
        assert_eq!(get(&s, &p, &head).revision, head_before);
        denied_dispatch_unchanged(
            &s,
            &p,
            &selected,
            DispatchAuthority::ExplicitQueueSelection,
            route,
            turn,
            ErrorKind::IllegalTransition,
        );
        s.record_input_accepted(&p, "one", &permit, &receipt(&op))
            .unwrap();
        assert_eq!(s.queue("one").unwrap()["paused"], true);
        assert_eq!(s.queue("one").unwrap()["editing"], queue["editing"]);
        assert!(
            s.queue("one").unwrap()["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}

#[test]
fn dispatch_authority_never_bypasses_route_pause_preparation_binding_or_archive_guards() {
    let (s, p, b) = fresh();
    let selected = queued_ready(&s, &p, &b);
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        Some("not-idle"),
        ErrorKind::Invalid,
    );
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Steer,
        None,
        ErrorKind::Invalid,
    );
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::QueueWorker,
        Route::Steer,
        Some("turn"),
        ErrorKind::Invalid,
    );
    s.pause_queue("one", true).unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::QueueWorker,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
    let mut session = s.session("one").unwrap();
    session.archived = true;
    s.save(&session).unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
    session.archived = false;
    session.thread_id = Some("changed-thread".into());
    s.save(&session).unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &selected,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        None,
        ErrorKind::BindingConflict,
    );
    session.thread_id = b.thread_id.clone();
    s.save(&session).unwrap();
    let pending = id();
    s.admit_queued_operation(&p, "one", &pending, &intent(), &b)
        .unwrap();
    denied_dispatch_unchanged(
        &s,
        &p,
        &pending,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
    let immediate = id();
    s.admit_operation(&p, "one", &immediate, &intent(), &b)
        .unwrap();
    ready(&s, &p, &immediate, false);
    denied_dispatch_unchanged(
        &s,
        &p,
        &immediate,
        DispatchAuthority::QueueWorker,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
    denied_dispatch_unchanged(
        &s,
        &p,
        &immediate,
        DispatchAuthority::ExplicitQueueSelection,
        Route::Start,
        None,
        ErrorKind::IllegalTransition,
    );
}
