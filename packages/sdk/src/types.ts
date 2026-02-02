/**
 * Token claims decoded from a processing JWT
 */
export interface TokenClaims {
  /** Subject (API key ID) */
  sub: string;
  /** Expiration time (Unix timestamp) */
  exp: number;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Number of conversions remaining in this token */
  conversions_remaining: number;
  /** Maximum file size in bytes */
  max_file_size: number;
  /** Allowed output formats */
  formats: string[];
}

/**
 * Statistics from cleaning operation
 */
export interface CleanStats {
  /** Number of splats before cleaning */
  original_count: number;
  /** Number of splats removed due to low opacity */
  removed_low_opacity: number;
  /** Number of splats removed due to small scale */
  removed_small_scale: number;
  /** Number of splats removed as outliers */
  removed_outliers: number;
  /** Number of splats after cleaning */
  final_count: number;
}

/**
 * Result of a successful conversion
 */
export interface ConvertResult {
  /** The converted file data */
  data: Uint8Array;
  /** Output format */
  format: "glb" | "gltf";
  /** Suggested filename */
  filename: string;
  /** Cleaning statistics (if cleaning was enabled) */
  cleanStats?: CleanStats;
}

/**
 * Options for SDK initialization
 */
export interface StereosOptions {
  /** Your API key */
  apiKey: string;
}

/**
 * Options for cleaning/filtering splats
 */
export interface CleanOptions {
  /** Remove splats with opacity below this threshold (default: 0.005 = 0.5%) */
  minOpacity?: number;
  /** Remove splats smaller than this in all dimensions (default: 0.0001) */
  minScale?: number;
  /** Remove splats beyond N standard deviations from centroid (default: disabled) */
  outlierSigma?: number;
}

/**
 * Options for conversion
 */
export interface ConvertOptions {
  /** Output format (defaults to 'glb') */
  format?: "glb" | "gltf";
  /** Quantize colors to u8 for smaller files (defaults to true) */
  quantizeColors?: boolean;
  /** Custom filename for the output */
  filename?: string;
  /** Enable cleaning with optional configuration (pass true for defaults, or CleanOptions) */
  clean?: boolean | CleanOptions;
  /**
   * Export full spherical harmonics coefficients for view-dependent rendering.
   * When false (default), only exports DC term as static color (smaller files).
   * When true, exports all 48 SH coefficients (~16x larger for SH data, but enables view-dependent effects).
   */
  exportFullSh?: boolean;
  /**
   * Quantize positions from f32 to normalized i16 for ~2x size reduction.
   * Uses KHR_mesh_quantization extension for proper decoding.
   * Defaults to false.
   */
  quantizePositions?: boolean;
  /**
   * Apply meshopt compression to vertex buffers for ~2-4x additional compression.
   * Uses EXT_meshopt_compression extension. Requires loader support (three.js r122+, Babylon.js 5.0+).
   * Defaults to false.
   */
  meshoptCompression?: boolean;
}

/**
 * Token response from the API
 */
export interface TokenResponse {
  token: string;
  expires_at: number;
  conversions_remaining: number;
}

/**
 * Error response from the API
 */
export interface ApiError {
  error: string;
  message?: string;
}
