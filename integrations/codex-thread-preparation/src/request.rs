use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::PreparationError;

// Preserve the retained RunRequest contract, including its HISTORICAL pins.
// These do not assert compatibility with current canonical Gelt. Any migration
// needs a separately reviewed contract delta; this module cannot admit a run.
pub const REQUEST_SCHEMA: &str = "gelt.headless-mock-action.v1";
pub const HISTORICAL_BASE: &str = "72dec8cc467d4d891fa9353db49419938eaac6bc";
pub const HISTORICAL_MOCK: &str =
    "57dc013475a9a3f0c12de2e8d83026165297dac3d9b619024dcf010a9bea2cc8";
const MAX_REQUEST_BYTES: usize = 4096;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireRequest {
    schema: String,
    run_id: String,
    base_commit: String,
    mock_candidate_identity_sha256: String,
    model: String,
    effort: String,
    timeout_ms: u64,
}

/// Exact immutable input, bound to a digest supplied by its existing owner.
/// Digest equality is byte linkage, not provenance or execution admission.
/// No output parser or proposal validation is replaced by this preparation.
pub struct BoundRequest<'a> {
    bytes: &'a [u8],
    sha256: [u8; 32],
    wire: WireRequest,
}

impl<'a> BoundRequest<'a> {
    pub fn parse(bytes: &'a [u8], expected_sha256: [u8; 32]) -> Result<Self, PreparationError> {
        if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES {
            return Err(PreparationError::InvalidRequest);
        }
        let sha256: [u8; 32] = Sha256::digest(bytes).into();
        if sha256 != expected_sha256 {
            return Err(PreparationError::RequestIdentityMismatch);
        }
        let wire: WireRequest =
            serde_json::from_slice(bytes).map_err(|_| PreparationError::InvalidRequest)?;
        let model_bytes = wire.model.as_bytes();
        if wire.schema != REQUEST_SCHEMA
            || wire.base_commit != HISTORICAL_BASE
            || wire.mock_candidate_identity_sha256 != HISTORICAL_MOCK
            || uuid::Uuid::parse_str(&wire.run_id).is_err()
            || wire.run_id.len() != 36
            || model_bytes.is_empty()
            || model_bytes.len() > 128
            || !model_bytes[0].is_ascii_alphanumeric()
            || !model_bytes.iter().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(b))
            || !matches!(wire.effort.as_str(), "low" | "medium" | "high" | "xhigh" | "max" | "ultra")
            || !(1000..=300_000).contains(&wire.timeout_ms)
        {
            return Err(PreparationError::InvalidRequest);
        }
        Ok(Self { bytes, sha256, wire })
    }

    pub fn bytes(&self) -> &[u8] { self.bytes }
    pub fn sha256(&self) -> [u8; 32] { self.sha256 }
    pub fn run_id(&self) -> &str { &self.wire.run_id }
    pub fn source_commit(&self) -> &str { &self.wire.base_commit }
    pub fn mock_identity(&self) -> &str { &self.wire.mock_candidate_identity_sha256 }
    pub fn model(&self) -> &str { &self.wire.model }
    pub fn effort(&self) -> &str { &self.wire.effort }
    pub fn timeout_ms(&self) -> u64 { self.wire.timeout_ms }
}
