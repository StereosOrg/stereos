//! WebAssembly bindings for Stereos
//!
//! This module provides JavaScript-accessible functions for converting
//! Gaussian splat PLY files to glTF format.

use serde::{Deserialize, Serialize};
use stereos_core::{
    convert_with_clean, CleanOptions as CoreCleanOptions, CleanStats as CoreCleanStats,
    ExportConfig, ExportFormat,
};
use wasm_bindgen::prelude::*;

// Embed public key at compile time
const PUBLIC_KEY: &str = include_str!("../../../keys/public.pem");

/// Initialize the WASM module (sets up panic hook for better error messages)
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Options for cleaning/filtering splats
#[wasm_bindgen]
#[derive(Clone)]
pub struct CleanOptions {
    min_opacity: f32,
    min_scale: f32,
    outlier_sigma: Option<f32>,
}

#[wasm_bindgen]
impl CleanOptions {
    /// Create new clean options with defaults
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            min_opacity: 0.005,
            min_scale: 0.0001,
            outlier_sigma: None,
        }
    }

    /// Set minimum opacity threshold (default: 0.005 = 0.5%)
    #[wasm_bindgen(setter)]
    pub fn set_min_opacity(&mut self, value: f32) {
        self.min_opacity = value;
    }

    #[wasm_bindgen(getter)]
    pub fn min_opacity(&self) -> f32 {
        self.min_opacity
    }

    /// Set minimum scale threshold (default: 0.0001)
    #[wasm_bindgen(setter)]
    pub fn set_min_scale(&mut self, value: f32) {
        self.min_scale = value;
    }

    #[wasm_bindgen(getter)]
    pub fn min_scale(&self) -> f32 {
        self.min_scale
    }

    /// Set outlier sigma threshold (default: disabled)
    /// Pass a value like 3.0 to remove splats beyond 3 standard deviations
    #[wasm_bindgen(js_name = setOutlierSigma)]
    pub fn set_outlier_sigma(&mut self, value: f32) {
        self.outlier_sigma = Some(value);
    }

    /// Disable outlier removal
    #[wasm_bindgen(js_name = disableOutlierRemoval)]
    pub fn disable_outlier_removal(&mut self) {
        self.outlier_sigma = None;
    }

    #[wasm_bindgen(getter, js_name = outlierSigma)]
    pub fn outlier_sigma(&self) -> Option<f32> {
        self.outlier_sigma
    }
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self::new()
    }
}

impl From<&CleanOptions> for CoreCleanOptions {
    fn from(opts: &CleanOptions) -> Self {
        CoreCleanOptions {
            min_opacity: opts.min_opacity,
            min_scale: opts.min_scale,
            outlier_sigma: opts.outlier_sigma,
        }
    }
}

/// Statistics from cleaning operation
#[derive(Serialize, Deserialize)]
pub struct CleanStatsJs {
    pub original_count: usize,
    pub removed_low_opacity: usize,
    pub removed_small_scale: usize,
    pub removed_outliers: usize,
    pub final_count: usize,
}

impl From<CoreCleanStats> for CleanStatsJs {
    fn from(stats: CoreCleanStats) -> Self {
        CleanStatsJs {
            original_count: stats.original_count,
            removed_low_opacity: stats.removed_low_opacity,
            removed_small_scale: stats.removed_small_scale,
            removed_outliers: stats.removed_outliers,
            final_count: stats.final_count,
        }
    }
}

/// Result of conversion with optional cleaning stats
#[derive(Serialize, Deserialize)]
pub struct ConvertResultJs {
    /// Cleaning statistics (if cleaning was enabled)
    pub clean_stats: Option<CleanStatsJs>,
}

/// Options for conversion
#[wasm_bindgen]
#[derive(Default)]
pub struct ConvertOptions {
    format: String,
    quantize_colors: bool,
    export_full_sh: bool,
    quantize_positions: bool,
    meshopt_compression: bool,
    clean_options: Option<CleanOptions>,
}

#[wasm_bindgen]
impl ConvertOptions {
    /// Create new conversion options with defaults
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            format: "glb".into(),
            quantize_colors: true,
            export_full_sh: false,
            quantize_positions: false,
            meshopt_compression: false,
            clean_options: None,
        }
    }

    /// Set output format ("glb" or "gltf")
    #[wasm_bindgen(setter)]
    pub fn set_format(&mut self, format: String) {
        self.format = format;
    }

    /// Get output format
    #[wasm_bindgen(getter)]
    pub fn format(&self) -> String {
        self.format.clone()
    }

    /// Set whether to quantize colors to u8
    #[wasm_bindgen(setter)]
    pub fn set_quantize_colors(&mut self, quantize: bool) {
        self.quantize_colors = quantize;
    }

    /// Get whether colors are quantized
    #[wasm_bindgen(getter)]
    pub fn quantize_colors(&self) -> bool {
        self.quantize_colors
    }

    /// Set whether to export full spherical harmonics (for view-dependent rendering)
    #[wasm_bindgen(setter, js_name = exportFullSh)]
    pub fn set_export_full_sh(&mut self, export: bool) {
        self.export_full_sh = export;
    }

    /// Get whether full SH is exported
    #[wasm_bindgen(getter, js_name = exportFullSh)]
    pub fn export_full_sh(&self) -> bool {
        self.export_full_sh
    }

    /// Set whether to quantize positions to i16 for smaller files
    #[wasm_bindgen(setter, js_name = quantizePositions)]
    pub fn set_quantize_positions(&mut self, quantize: bool) {
        self.quantize_positions = quantize;
    }

    /// Get whether positions are quantized
    #[wasm_bindgen(getter, js_name = quantizePositions)]
    pub fn quantize_positions(&self) -> bool {
        self.quantize_positions
    }

    /// Set whether to use meshopt compression for smaller files
    #[wasm_bindgen(setter, js_name = meshoptCompression)]
    pub fn set_meshopt_compression(&mut self, compress: bool) {
        self.meshopt_compression = compress;
    }

    /// Get whether meshopt compression is enabled
    #[wasm_bindgen(getter, js_name = meshoptCompression)]
    pub fn meshopt_compression(&self) -> bool {
        self.meshopt_compression
    }

    /// Enable cleaning with specified options
    #[wasm_bindgen(js_name = setCleanOptions)]
    pub fn set_clean_options(&mut self, options: CleanOptions) {
        self.clean_options = Some(options);
    }

    /// Enable cleaning with default options
    #[wasm_bindgen(js_name = enableCleaning)]
    pub fn enable_cleaning(&mut self) {
        self.clean_options = Some(CleanOptions::new());
    }

    /// Disable cleaning
    #[wasm_bindgen(js_name = disableCleaning)]
    pub fn disable_cleaning(&mut self) {
        self.clean_options = None;
    }
}

/// Token claims returned from validation
#[derive(Serialize, Deserialize)]
pub struct TokenClaimsJs {
    pub sub: String,
    pub exp: u64,
    pub iat: u64,
    pub conversions_remaining: u32,
    pub max_file_size: u64,
    pub formats: Vec<String>,
}

/// Convert a PLY file to glTF/glb format
///
/// # Arguments
/// * `ply_data` - Raw bytes of the PLY file
/// * `token` - JWT token for authorization
/// * `options` - Optional conversion options (including cleaning)
///
/// # Returns
/// The converted glTF/glb data as a Uint8Array
#[wasm_bindgen]
pub fn convert_ply(
    ply_data: &[u8],
    token: &str,
    options: Option<ConvertOptions>,
) -> Result<Vec<u8>, JsError> {
    let opts = options.unwrap_or_default();

    let config = ExportConfig {
        format: match opts.format.to_lowercase().as_str() {
            "gltf" => ExportFormat::GltfEmbedded,
            _ => ExportFormat::Glb,
        },
        quantize_colors: opts.quantize_colors,
        export_full_sh: opts.export_full_sh,
        quantize_positions: opts.quantize_positions,
        meshopt_compression: opts.meshopt_compression,
    };

    let clean_opts = opts.clean_options.as_ref().map(CoreCleanOptions::from);

    let result = convert_with_clean(ply_data, token, PUBLIC_KEY, config, clean_opts.as_ref())
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(result.data)
}

/// Convert a PLY file with cleaning and return both data and statistics
///
/// # Arguments
/// * `ply_data` - Raw bytes of the PLY file
/// * `token` - JWT token for authorization
/// * `options` - Optional conversion options (including cleaning)
///
/// # Returns
/// An object with `data` (Uint8Array) and `cleanStats` (if cleaning enabled)
#[wasm_bindgen]
pub fn convert_ply_with_stats(
    ply_data: &[u8],
    token: &str,
    options: Option<ConvertOptions>,
) -> Result<JsValue, JsError> {
    let opts = options.unwrap_or_default();

    let config = ExportConfig {
        format: match opts.format.to_lowercase().as_str() {
            "gltf" => ExportFormat::GltfEmbedded,
            _ => ExportFormat::Glb,
        },
        quantize_colors: opts.quantize_colors,
        export_full_sh: opts.export_full_sh,
        quantize_positions: opts.quantize_positions,
        meshopt_compression: opts.meshopt_compression,
    };

    let clean_opts = opts.clean_options.as_ref().map(CoreCleanOptions::from);

    let result = convert_with_clean(ply_data, token, PUBLIC_KEY, config, clean_opts.as_ref())
        .map_err(|e| JsError::new(&e.to_string()))?;

    // Create a JS object with both data and stats
    let js_result = js_sys::Object::new();

    // Set the data as Uint8Array
    let data_array = js_sys::Uint8Array::from(result.data.as_slice());
    js_sys::Reflect::set(&js_result, &"data".into(), &data_array)
        .map_err(|e| JsError::new(&format!("Failed to set data: {:?}", e)))?;

    // Set clean stats if available
    if let Some(stats) = result.clean_stats {
        let stats_js: CleanStatsJs = stats.into();
        let stats_value =
            serde_wasm_bindgen::to_value(&stats_js).map_err(|e| JsError::new(&e.to_string()))?;
        js_sys::Reflect::set(&js_result, &"cleanStats".into(), &stats_value)
            .map_err(|e| JsError::new(&format!("Failed to set cleanStats: {:?}", e)))?;
    }

    Ok(js_result.into())
}

/// Validate a token and return its claims
///
/// # Arguments
/// * `token` - JWT token to validate
///
/// # Returns
/// The token claims as a JavaScript object
#[wasm_bindgen]
pub fn validate_token(token: &str) -> Result<JsValue, JsError> {
    let claims =
        stereos_core::token::validate(token, PUBLIC_KEY).map_err(|e| JsError::new(&e.to_string()))?;

    let claims_js = TokenClaimsJs {
        sub: claims.sub,
        exp: claims.exp,
        iat: claims.iat,
        conversions_remaining: claims.conversions_remaining,
        max_file_size: claims.max_file_size,
        formats: claims.formats,
    };

    serde_wasm_bindgen::to_value(&claims_js).map_err(|e| JsError::new(&e.to_string()))
}

/// Get the version of the Stereos WASM module
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
