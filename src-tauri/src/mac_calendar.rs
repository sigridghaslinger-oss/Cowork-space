// Liest Termine über EventKit, also aus allen Konten der Kalender-App
// (iCloud, Google, Outlook …), inklusive Serienterminen wie dem Stundenplan.
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
use objc2_foundation::{NSDate, NSError};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacEvent {
    id: String,
    calendar: String,
    title: String,
    start: f64,
    end: f64,
    all_day: bool,
    location: Option<String>,
}

fn ensure_access(store: &EKEventStore) -> Result<(), String> {
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    if status == EKAuthorizationStatus::FullAccess {
        return Ok(());
    }
    if status != EKAuthorizationStatus::NotDetermined {
        return Err("Cowork Space darf deinen Kalender nicht lesen. Erlaube den Zugriff unter Systemeinstellungen → Datenschutz & Sicherheit → Kalender.".into());
    }

    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        let _ = tx.send(granted.as_bool());
    });
    unsafe { store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&handler)) };
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Ok(()),
        _ => Err("Ohne Kalender-Zugriff kann Cowork Space keine Termine anzeigen.".into()),
    }
}

/// `day_start_ms`: Beginn des Tages (lokale Mitternacht) in Millisekunden seit 1970.
pub fn events_for_day(day_start_ms: f64) -> Result<Vec<MacEvent>, String> {
    let store = unsafe { EKEventStore::new() };
    ensure_access(&store)?;

    let start = NSDate::dateWithTimeIntervalSince1970(day_start_ms / 1000.0);
    let end = NSDate::dateWithTimeIntervalSince1970(day_start_ms / 1000.0 + 24.0 * 60.0 * 60.0);
    let predicate = unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };
    let events = unsafe { store.eventsMatchingPredicate(&predicate) };

    let mut result: Vec<MacEvent> = events
        .iter()
        .map(|e| unsafe {
            MacEvent {
                id: e.eventIdentifier().map(|s| s.to_string()).unwrap_or_default()
                    + &e.startDate().timeIntervalSince1970().to_string(),
                calendar: e.calendar().map(|c| c.title().to_string()).unwrap_or_default(),
                title: e.title().to_string(),
                start: e.startDate().timeIntervalSince1970() * 1000.0,
                end: e.endDate().timeIntervalSince1970() * 1000.0,
                all_day: e.isAllDay(),
                location: e.location().map(|s| s.to_string()).filter(|s| !s.is_empty()),
            }
        })
        .collect();
    result.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(result)
}
