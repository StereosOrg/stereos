//! Stereos Core - Gaussian Splat to glTF Conversion
//!
//! This library provides functionality for:
//! - Parsing 3D Gaussian Splatting PLY files
//! - Cleaning and filtering splat data
//! - Exporting to glTF/glb with KHR_gaussian_splatting extension
//! - JWT token validation for metered API access

pub mod clean;
pub mod gltf;
pub mod ply;
pub mod token;

pub use clean::{CleanOptions, CleanStats};
pub use gltf::{BufferViewCompressionInfo, CompressionStats, ExportResult};

use glam::{Quat, Vec3};
use thiserror::Error;

/// Errors that can occur during splat processing
#[derive(Error, Debug)]
pub enum SplatsError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("PLY parsing error: {0}")]
    Ply(String),

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Token error: {0}")]
    Token(String),

    #[error("Quota exceeded")]
    QuotaExceeded,

    #[error("File too large: {size} bytes exceeds limit of {limit} bytes")]
    FileTooLarge { size: u64, limit: u64 },
}

pub type Result<T> = std::result::Result<T, SplatsError>;

/// A collection of 3D Gaussian splats
#[derive(Clone, Debug)]
pub struct GaussianCloud {
    /// Number of Gaussians
    pub count: usize,
    /// Gaussian centers (x, y, z)
    pub positions: Vec<Vec3>,
    /// Opacity values [0, 1]
    pub opacities: Vec<f32>,
    /// Anisotropic scales (already exp'd from log-space)
    pub scales: Vec<Vec3>,
    /// Rotation quaternions (normalized)
    pub rotations: Vec<Quat>,
    /// Spherical harmonics coefficients (48 floats per Gaussian)
    /// Layout: [R_dc, G_dc, B_dc, followed by higher-order coefficients]
    pub sh_coeffs: Vec<[f32; 48]>,
}

impl GaussianCloud {
    /// Create a new empty GaussianCloud with pre-allocated capacity
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            count: 0,
            positions: Vec::with_capacity(capacity),
            opacities: Vec::with_capacity(capacity),
            scales: Vec::with_capacity(capacity),
            rotations: Vec::with_capacity(capacity),
            sh_coeffs: Vec::with_capacity(capacity),
        }
    }
}

/// Export format options
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ExportFormat {
    /// Binary glTF (.glb) - recommended for production
    #[default]
    Glb,
    /// JSON glTF with embedded base64 buffer
    GltfEmbedded,
}

/// Configuration for glTF export
#[derive(Clone, Debug)]
pub struct ExportConfig {
    /// Output format (GLB or embedded glTF)
    pub format: ExportFormat,
    /// Quantize colors to u8 (smaller) vs f32 (more precise)
    pub quantize_colors: bool,
    /// Export full spherical harmonics coefficients for view-dependent rendering.
    /// When false (default), only exports DC term as static COLOR_0 (smaller files).
    /// When true, exports all 48 SH coefficients as _SH_COEFFICIENTS attribute.
    pub export_full_sh: bool,
    /// Quantize positions from f32 to normalized i16 for ~2x size reduction.
    /// Uses KHR_mesh_quantization extension with min/max bounds for decoding.
    pub quantize_positions: bool,
    /// Apply meshopt compression to buffer views for ~2-4x additional compression.
    /// Uses EXT_meshopt_compression extension. Requires meshopt feature.
    pub meshopt_compression: bool,
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            format: ExportFormat::Glb,
            quantize_colors: true,
            export_full_sh: false,
            quantize_positions: false,
            meshopt_compression: false,
        }
    }
}

/// Result of a conversion with cleaning statistics
pub struct ConvertResult {
    /// The converted glTF/glb data
    pub data: Vec<u8>,
    /// Cleaning statistics (if cleaning was enabled)
    pub clean_stats: Option<CleanStats>,
    /// Compression statistics (if meshopt compression was enabled)
    pub compression_stats: Option<CompressionStats>,
}

/// Main conversion function
///
/// Validates the token, parses the PLY data, and exports to glTF format.
///
/// # Arguments
/// * `ply_data` - Raw bytes of the PLY file
/// * `token` - JWT token for authorization
/// * `public_key` - PEM-encoded Ed25519 public key for token verification
/// * `config` - Export configuration
///
/// # Returns
/// The exported glTF/glb data as bytes
pub fn convert(
    ply_data: &[u8],
    token: &str,
    public_key: &str,
    config: ExportConfig,
) -> Result<Vec<u8>> {
    convert_with_clean(ply_data, token, public_key, config, None).map(|r| r.data)
}

/// Convert with optional cleaning
///
/// Validates the token, parses the PLY data, optionally cleans it, and exports to glTF format.
///
/// # Arguments
/// * `ply_data` - Raw bytes of the PLY file
/// * `token` - JWT token for authorization
/// * `public_key` - PEM-encoded Ed25519 public key for token verification
/// * `config` - Export configuration
/// * `clean_options` - Optional cleaning configuration
///
/// # Returns
/// The exported glTF/glb data and cleaning statistics
pub fn convert_with_clean(
    ply_data: &[u8],
    token: &str,
    public_key: &str,
    config: ExportConfig,
    clean_options: Option<&CleanOptions>,
) -> Result<ConvertResult> {
    // 1. Validate token
    let claims = token::validate(token, public_key)?;

    if claims.conversions_remaining == 0 {
        return Err(SplatsError::QuotaExceeded);
    }

    // 2. Check file size limit
    let file_size = ply_data.len() as u64;
    if file_size > claims.max_file_size {
        return Err(SplatsError::FileTooLarge {
            size: file_size,
            limit: claims.max_file_size,
        });
    }

    // 3. Parse PLY
    let cloud = ply::parse(ply_data)?;

    // 4. Optionally clean the cloud
    let (cloud, clean_stats) = if let Some(opts) = clean_options {
        let (cleaned, stats) = cloud.clean(opts);
        (cleaned, Some(stats))
    } else {
        (cloud, None)
    };

    // 5. Export to glTF/glb
    let (output, compression_stats) = match config.format {
        ExportFormat::Glb => {
            let result = gltf::export_glb_with_stats(&cloud, &config)?;
            (result.data, result.compression_stats)
        }
        ExportFormat::GltfEmbedded => {
            let result = gltf::export_gltf_embedded_with_stats(&cloud, &config)?;
            (result.data, result.compression_stats)
        }
    };

    Ok(ConvertResult {
        data: output,
        clean_stats,
        compression_stats,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_cloud_capacity() {
        let cloud = GaussianCloud::with_capacity(1000);
        assert_eq!(cloud.count, 0);
        assert!(cloud.positions.capacity() >= 1000);
    }

    #[test]
    fn test_export_config_default() {
        let config = ExportConfig::default();
        assert_eq!(config.format, ExportFormat::Glb);
        assert!(config.quantize_colors);
    }
}
