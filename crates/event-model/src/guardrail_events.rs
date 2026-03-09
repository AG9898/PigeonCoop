use serde::{Deserialize, Serialize};

/// Severity level for guardrail warnings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuardrailSeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// Payload for `guardrail.warning` — a guardrail threshold is approaching.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardrailWarningPayload {
    /// Which guardrail triggered the warning (e.g. "token_budget", "time_limit", "retry_count").
    pub guardrail: String,
    pub severity: GuardrailSeverity,
    /// Human-readable description of the warning.
    pub message: String,
    /// Current value of the tracked metric.
    pub current_value: f64,
    /// Threshold that would trigger an exceeded event.
    pub threshold: f64,
}

/// Payload for `guardrail.exceeded` — a guardrail limit has been breached;
/// the engine should take corrective action (pause, fail, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardrailExceededPayload {
    /// Which guardrail was exceeded.
    pub guardrail: String,
    /// Human-readable description of what was exceeded.
    pub message: String,
    /// The value at which the limit was breached.
    pub final_value: f64,
    /// The threshold that was breached.
    pub threshold: f64,
    /// Action the engine should take (e.g. "pause_run", "fail_node", "cancel_run").
    pub enforcement_action: String,
}

/// The kind of budget resource being tracked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetResource {
    Tokens,
    Time,
    ApiCalls,
    Retries,
}

/// Payload for `budget.updated` — a tracked budget counter was updated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetUpdatedPayload {
    /// Which resource is being tracked.
    pub resource: BudgetResource,
    /// Amount consumed so far.
    pub consumed: f64,
    /// Total budget allocated.
    pub limit: f64,
    /// Remaining budget.
    pub remaining: f64,
}

/// Typed discriminant for all guardrail / budget events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "payload", rename_all = "snake_case")]
pub enum GuardrailEventKind {
    #[serde(rename = "guardrail.warning")]
    Warning(GuardrailWarningPayload),
    #[serde(rename = "guardrail.exceeded")]
    Exceeded(GuardrailExceededPayload),
    #[serde(rename = "budget.updated")]
    BudgetUpdated(BudgetUpdatedPayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guardrail_warning_round_trip() {
        let p = GuardrailWarningPayload {
            guardrail: "token_budget".into(),
            severity: GuardrailSeverity::High,
            message: "Token usage at 85% of limit".into(),
            current_value: 8500.0,
            threshold: 10000.0,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: GuardrailWarningPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.guardrail, "token_budget");
        assert_eq!(back.current_value, 8500.0);
    }

    #[test]
    fn guardrail_exceeded_round_trip() {
        let p = GuardrailExceededPayload {
            guardrail: "time_limit".into(),
            message: "Run exceeded 5 minute time limit".into(),
            final_value: 305.0,
            threshold: 300.0,
            enforcement_action: "cancel_run".into(),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: GuardrailExceededPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.enforcement_action, "cancel_run");
        assert_eq!(back.threshold, 300.0);
    }

    #[test]
    fn budget_updated_round_trip() {
        let p = BudgetUpdatedPayload {
            resource: BudgetResource::Tokens,
            consumed: 4200.0,
            limit: 10000.0,
            remaining: 5800.0,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: BudgetUpdatedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.consumed, 4200.0);
        assert_eq!(back.remaining, 5800.0);
    }

    #[test]
    fn budget_resource_serializes_snake_case() {
        let v: serde_json::Value = serde_json::to_value(BudgetResource::ApiCalls).unwrap();
        assert_eq!(v, "api_calls");
    }

    #[test]
    fn guardrail_severity_serializes_snake_case() {
        let v: serde_json::Value = serde_json::to_value(GuardrailSeverity::Critical).unwrap();
        assert_eq!(v, "critical");
    }

    #[test]
    fn event_kind_serializes_with_tag() {
        let event = GuardrailEventKind::Warning(GuardrailWarningPayload {
            guardrail: "retry_count".into(),
            severity: GuardrailSeverity::Medium,
            message: "3 of 5 retries used".into(),
            current_value: 3.0,
            threshold: 5.0,
        });
        let v: serde_json::Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["event_type"], "guardrail.warning");
        assert_eq!(v["payload"]["guardrail"], "retry_count");
    }

    #[test]
    fn all_three_variants_serialize() {
        let variants: Vec<GuardrailEventKind> = vec![
            GuardrailEventKind::Warning(GuardrailWarningPayload {
                guardrail: "g".into(),
                severity: GuardrailSeverity::Low,
                message: "m".into(),
                current_value: 1.0,
                threshold: 10.0,
            }),
            GuardrailEventKind::Exceeded(GuardrailExceededPayload {
                guardrail: "g".into(),
                message: "m".into(),
                final_value: 11.0,
                threshold: 10.0,
                enforcement_action: "fail_node".into(),
            }),
            GuardrailEventKind::BudgetUpdated(BudgetUpdatedPayload {
                resource: BudgetResource::Time,
                consumed: 60.0,
                limit: 300.0,
                remaining: 240.0,
            }),
        ];
        assert_eq!(variants.len(), 3);
        for v in &variants {
            serde_json::to_string(v).expect("variant should serialize");
        }
    }

    #[test]
    fn event_kind_deserializes_from_json() {
        let json = r#"{"event_type":"budget.updated","payload":{"resource":"retries","consumed":2.0,"limit":5.0,"remaining":3.0}}"#;
        let kind: GuardrailEventKind = serde_json::from_str(json).unwrap();
        match kind {
            GuardrailEventKind::BudgetUpdated(p) => {
                assert_eq!(p.consumed, 2.0);
                assert_eq!(p.remaining, 3.0);
            }
            _ => panic!("expected BudgetUpdated variant"),
        }
    }
}
