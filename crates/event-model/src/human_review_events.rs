use serde::{Deserialize, Serialize};

/// Payload for `review.required` — execution is paused pending human review.
/// Matches EVENT_SCHEMA.md §4.5.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRequiredPayload {
    /// Why review is needed.
    pub reason: String,
    /// Whether the run is blocked until the review completes.
    pub blocking: bool,
    /// Actions the reviewer can take (e.g. "approve", "reject", "retry", "edit_memory").
    pub available_actions: Vec<String>,
}

/// Payload for `review.approved` — the reviewer approved the current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewApprovedPayload {
    /// Optional comment from the reviewer.
    pub comment: Option<String>,
}

/// Payload for `review.rejected` — the reviewer rejected the current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRejectedPayload {
    /// Reason for rejection.
    pub reason: String,
}

/// Payload for `review.edited` — the reviewer edited run memory before continuing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewEditedPayload {
    /// Memory keys that were modified by the reviewer.
    pub edited_keys: Vec<String>,
    /// Optional comment describing what was changed.
    pub comment: Option<String>,
}

/// Payload for `review.retry_requested` — the reviewer requested a retry of the
/// failed or waiting node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRetryRequestedPayload {
    /// Which node should be retried.
    pub target_node_id: String,
    /// Optional comment or instructions for the retry.
    pub comment: Option<String>,
}

/// Typed discriminant for all human review events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum HumanReviewEventKind {
    #[serde(rename = "review.required")]
    Required(ReviewRequiredPayload),
    #[serde(rename = "review.approved")]
    Approved(ReviewApprovedPayload),
    #[serde(rename = "review.rejected")]
    Rejected(ReviewRejectedPayload),
    #[serde(rename = "review.edited")]
    Edited(ReviewEditedPayload),
    #[serde(rename = "review.retry_requested")]
    RetryRequested(ReviewRetryRequestedPayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_required_matches_schema() {
        let p = ReviewRequiredPayload {
            reason: "Tests failed after patch application".into(),
            blocking: true,
            available_actions: vec![
                "approve".into(),
                "reject".into(),
                "retry".into(),
                "edit_memory".into(),
            ],
        };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert_eq!(v["reason"], "Tests failed after patch application");
        assert_eq!(v["blocking"], true);
        assert_eq!(v["available_actions"].as_array().unwrap().len(), 4);

        let back: ReviewRequiredPayload = serde_json::from_value(v).unwrap();
        assert!(back.blocking);
        assert_eq!(back.available_actions[0], "approve");
    }

    #[test]
    fn review_approved_round_trip() {
        let p = ReviewApprovedPayload {
            comment: Some("Looks good".into()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: ReviewApprovedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.comment.as_deref(), Some("Looks good"));
    }

    #[test]
    fn review_approved_no_comment() {
        let p = ReviewApprovedPayload { comment: None };
        let v: serde_json::Value = serde_json::to_value(&p).unwrap();
        assert!(v["comment"].is_null());
    }

    #[test]
    fn review_rejected_round_trip() {
        let p = ReviewRejectedPayload {
            reason: "Output quality too low".into(),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: ReviewRejectedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.reason, "Output quality too low");
    }

    #[test]
    fn review_edited_round_trip() {
        let p = ReviewEditedPayload {
            edited_keys: vec!["task_brief".into(), "constraints".into()],
            comment: Some("Narrowed scope".into()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: ReviewEditedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.edited_keys.len(), 2);
        assert_eq!(back.comment.as_deref(), Some("Narrowed scope"));
    }

    #[test]
    fn review_retry_requested_round_trip() {
        let p = ReviewRetryRequestedPayload {
            target_node_id: "node_tool_1".into(),
            comment: None,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: ReviewRetryRequestedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.target_node_id, "node_tool_1");
        assert!(back.comment.is_none());
    }

    #[test]
    fn event_kind_serializes_with_tag() {
        let event = HumanReviewEventKind::Required(ReviewRequiredPayload {
            reason: "needs review".into(),
            blocking: true,
            available_actions: vec!["approve".into()],
        });
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["event_type"], "review.required");
        assert_eq!(v["payload"]["blocking"], true);
    }

    #[test]
    fn all_five_variants_serialize() {
        let variants: Vec<HumanReviewEventKind> = vec![
            HumanReviewEventKind::Required(ReviewRequiredPayload {
                reason: "r".into(),
                blocking: false,
                available_actions: vec![],
            }),
            HumanReviewEventKind::Approved(ReviewApprovedPayload { comment: None }),
            HumanReviewEventKind::Rejected(ReviewRejectedPayload {
                reason: "bad".into(),
            }),
            HumanReviewEventKind::Edited(ReviewEditedPayload {
                edited_keys: vec!["k".into()],
                comment: None,
            }),
            HumanReviewEventKind::RetryRequested(ReviewRetryRequestedPayload {
                target_node_id: "n".into(),
                comment: None,
            }),
        ];
        assert_eq!(variants.len(), 5);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }

    #[test]
    fn event_kind_deserializes_from_json() {
        let json = r#"{"event_type":"review.rejected","payload":{"reason":"not ready"}}"#;
        let kind: HumanReviewEventKind = serde_json::from_str(json).unwrap();
        match kind {
            HumanReviewEventKind::Rejected(p) => assert_eq!(p.reason, "not ready"),
            _ => panic!("expected Rejected variant"),
        }
    }
}
