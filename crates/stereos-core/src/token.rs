//! JWT token validation for API authorization
//!
//! Tokens are Ed25519-signed JWTs containing:
//! - Subject (API key ID)
//! - Expiration time
//! - Conversion quota
//! - File size limits
//! - Allowed formats

use crate::{Result, SplatsError};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

/// Claims contained in a processing token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    /// Subject (API key ID)
    pub sub: String,

    /// Expiration time (Unix timestamp)
    pub exp: u64,

    /// Issued at (Unix timestamp)
    pub iat: u64,

    /// Number of conversions allowed with this token
    pub conversions_remaining: u32,

    /// Maximum file size in bytes
    pub max_file_size: u64,

    /// Allowed output formats
    pub formats: Vec<String>,
}

impl TokenClaims {
    /// Check if a specific format is allowed by this token
    pub fn allows_format(&self, format: &str) -> bool {
        self.formats.iter().any(|f| f.eq_ignore_ascii_case(format))
    }
}

// Native implementation using jsonwebtoken (ring-based)
#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

    pub fn validate(token: &str, public_key_pem: &str) -> Result<TokenClaims> {
        let key = DecodingKey::from_ed_pem(public_key_pem.as_bytes())
            .map_err(|e| SplatsError::Token(format!("Invalid public key: {}", e)))?;

        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_required_spec_claims(&["exp", "sub", "iat"]);

        let token_data = decode::<TokenClaims>(token, &key, &validation)
            .map_err(|e| SplatsError::Token(format!("Invalid token: {}", e)))?;

        Ok(token_data.claims)
    }
}

// WASM implementation using ed25519-dalek (pure Rust)
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use ed25519_dalek::{Signature, VerifyingKey, pkcs8::DecodePublicKey};

    /// Parse PEM to get the raw public key bytes
    fn parse_pem_public_key(pem: &str) -> Result<VerifyingKey> {
        VerifyingKey::from_public_key_pem(pem)
            .map_err(|e| SplatsError::Token(format!("Invalid public key: {}", e)))
    }

    /// Decode a base64url-encoded string
    fn b64_decode(input: &str) -> Result<Vec<u8>> {
        URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|e| SplatsError::Token(format!("Invalid base64: {}", e)))
    }

    pub fn validate(token: &str, public_key_pem: &str) -> Result<TokenClaims> {
        // Parse the JWT: header.payload.signature
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(SplatsError::Token("Invalid JWT format".into()));
        }

        let header_b64 = parts[0];
        let payload_b64 = parts[1];
        let signature_b64 = parts[2];

        // Verify signature
        let public_key = parse_pem_public_key(public_key_pem)?;
        let message = format!("{}.{}", header_b64, payload_b64);
        let signature_bytes = b64_decode(signature_b64)?;

        if signature_bytes.len() != 64 {
            return Err(SplatsError::Token("Invalid signature length".into()));
        }

        let signature = Signature::from_bytes(signature_bytes.as_slice().try_into().unwrap());

        use ed25519_dalek::Verifier;
        public_key
            .verify(message.as_bytes(), &signature)
            .map_err(|_| SplatsError::Token("Invalid signature".into()))?;

        // Decode and parse payload
        let payload_bytes = b64_decode(payload_b64)?;
        let claims: TokenClaims = serde_json::from_slice(&payload_bytes)
            .map_err(|e| SplatsError::Token(format!("Invalid claims: {}", e)))?;

        // Check expiration
        let now = current_timestamp();
        if claims.exp < now {
            return Err(SplatsError::Token("Token expired".into()));
        }

        Ok(claims)
    }

    /// Get current Unix timestamp (seconds since epoch)
    fn current_timestamp() -> u64 {
        // In WASM, we use js_sys to get the current time
        #[cfg(target_arch = "wasm32")]
        {
            (js_sys::Date::now() / 1000.0) as u64
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        }
    }
}

/// Validate a JWT token using the provided Ed25519 public key
///
/// # Arguments
/// * `token` - The JWT token string
/// * `public_key_pem` - PEM-encoded Ed25519 public key
///
/// # Returns
/// The decoded token claims if valid
///
/// # Errors
/// Returns `SplatsError::Token` if:
/// - The public key is invalid
/// - The token signature is invalid
/// - The token has expired
/// - Required claims are missing
#[cfg(not(target_arch = "wasm32"))]
pub use native::validate;

#[cfg(target_arch = "wasm32")]
pub use wasm::validate;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claims_allows_format() {
        let claims = TokenClaims {
            sub: "test".into(),
            exp: 0,
            iat: 0,
            conversions_remaining: 10,
            max_file_size: 1024,
            formats: vec!["glb".into(), "gltf".into()],
        };

        assert!(claims.allows_format("glb"));
        assert!(claims.allows_format("GLB"));
        assert!(claims.allows_format("gltf"));
        assert!(!claims.allows_format("obj"));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_validate_invalid_key() {
        let result = validate("some.token.here", "not a valid key");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid public key"));
    }
}
