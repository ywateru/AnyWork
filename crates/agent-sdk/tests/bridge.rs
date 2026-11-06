use remote_agent_sdk::RpcProcess;
use serde_json::json;
use std::time::Duration;

#[tokio::test]
async fn delayed_receipt_does_not_lock_out_other_calls() {
    let (rpc, _events, mut bridge) = RpcProcess::bridge();
    let first = rpc.clone();
    let first = tokio::spawn(async move { first.call("slow", json!({})).await });
    let slow = bridge.requests.recv().await.unwrap();
    let second = rpc.clone();
    let second = tokio::spawn(async move { second.call("read", json!({})).await });
    let read = tokio::time::timeout(Duration::from_secs(1), bridge.requests.recv())
        .await
        .expect("another call must pass while the first receipt is pending")
        .unwrap();
    bridge
        .responses
        .send(json!({"id":read.value.unwrap()["id"],"result":"read-ok"}))
        .unwrap();
    read.accepted.send(Ok(())).unwrap();
    assert_eq!(second.await.unwrap().unwrap(), "read-ok");
    bridge
        .responses
        .send(json!({"id":slow.value.unwrap()["id"],"result":"slow-ok"}))
        .unwrap();
    slow.accepted.send(Ok(())).unwrap();
    assert_eq!(first.await.unwrap().unwrap(), "slow-ok");
}

#[tokio::test]
async fn approval_send_reports_actual_adapter_rejection() {
    let (rpc, _events, mut bridge) = RpcProcess::bridge();
    let send = tokio::spawn(async move { rpc.send(json!({"id":"approval","result":{}})).await });
    let request = bridge.requests.recv().await.unwrap();
    request
        .accepted
        .send(Err(anyhow::anyhow!("original owner rejected response")))
        .unwrap();
    assert!(
        send.await
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("original owner rejected")
    );
}

#[tokio::test]
async fn closing_bridge_only_signals_adapter_and_drops_outstanding_call() {
    let (rpc, _events, mut bridge) = RpcProcess::bridge();
    let pending = rpc.clone();
    let pending = tokio::spawn(async move { pending.call("pending", json!({})).await });
    let request = bridge.requests.recv().await.unwrap();
    request.accepted.send(Ok(())).unwrap();
    rpc.close().await;
    assert!(bridge.requests.recv().await.unwrap().value.is_none());
    drop(bridge);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
}
