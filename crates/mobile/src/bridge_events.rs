//! Connection retirement must remain observable when the bounded PTY queue fills.
use crate::transport::{ConnectionRef, EventSink, TransportEvent};
use std::sync::Arc;
use tokio::sync::mpsc;

pub(crate) fn event_sink(
    data: mpsc::Sender<TransportEvent>,
    closed: impl Fn(ConnectionRef, &'static str) -> bool + Send + Sync + 'static,
) -> EventSink {
    Arc::new(move |event| match event {
        TransportEvent::Closed { connection, code } => closed(connection, code),
        event => data.try_send(event).is_ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::OperationRef;
    use std::sync::Mutex;

    fn connection() -> ConnectionRef {
        ConnectionRef {
            connection_id: "fixture".into(),
            generation: 7,
        }
    }
    fn data() -> TransportEvent {
        TransportEvent::PtyData {
            operation: OperationRef {
                connection: connection(),
                operation_id: "pty".into(),
            },
            sequence: 1,
            base64: "YQ==".into(),
        }
    }
    #[test]
    fn full_data_queue_still_delivers_exact_connection_retirement() {
        let (send, mut receive) = mpsc::channel(64);
        let retired = Arc::new(Mutex::new(Vec::new()));
        let observed = retired.clone();
        let sink = event_sink(send, move |connection, code| {
            observed.lock().unwrap().push((connection, code));
            true
        });
        for _ in 0..64 {
            assert!(sink(data()));
        }
        assert!(!sink(data())); // Overflow still shuts down the producing peer.
        assert!(sink(TransportEvent::Closed {
            connection: connection(),
            code: "LIMIT_EXCEEDED"
        }));
        assert_eq!(
            *retired.lock().unwrap(),
            vec![(connection(), "LIMIT_EXCEEDED")]
        );
        for _ in 0..64 {
            assert!(matches!(
                receive.try_recv(),
                Ok(TransportEvent::PtyData { .. })
            ));
        }
        assert!(receive.try_recv().is_err());
    }
    #[test]
    fn dropped_receiver_still_delivers_retirement() {
        let (send, receive) = mpsc::channel(1);
        drop(receive);
        let retired = Arc::new(Mutex::new(false));
        let observed = retired.clone();
        let sink = event_sink(send, move |_, _| {
            *observed.lock().unwrap() = true;
            true
        });
        assert!(!sink(data()));
        assert!(sink(TransportEvent::Closed {
            connection: connection(),
            code: "CONNECTION_CLOSED"
        }));
        assert!(*retired.lock().unwrap());
    }
}
